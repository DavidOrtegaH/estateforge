import net from 'node:net'

import nodemailer from 'nodemailer'
import { afterEach, describe, expect, it } from 'vitest'

import { deliveryStateFields, isDeliveryUnconfirmed } from './log-safety.js'

// Formas reales de los errores de nodemailer 10.0.12 ante un servidor SMTP falso en 127.0.0.1, con
// fallos inyectados (DA-39). No se conecta a ningún servicio de correo real.

type Mode = 'reject-rcpt' | 'reject-data' | 'drop-after-data' | 'silent' | 'accept'

const CRLF = String.fromCharCode(13, 10)
const END_OF_DATA = CRLF + '.' + CRLF

const servers: net.Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function fakeSmtp(mode: Mode): Promise<number> {
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    if (mode === 'silent') return
    const reply = (line: string) => socket.write(line + CRLF)
    reply('220 falso ESMTP')
    let inData = false
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1')
      for (;;) {
        if (inData) {
          const end = buffer.indexOf(END_OF_DATA)
          if (end === -1) return
          buffer = buffer.slice(end + END_OF_DATA.length)
          inData = false
          // El servidor ya tiene el mensaje entero: puede haberlo aceptado.
          if (mode === 'drop-after-data') {
            socket.destroy()
            return
          }
          reply(mode === 'reject-data' ? '554 5.7.1 Mensaje rechazado' : '250 2.0.0 Aceptado')
          continue
        }
        const lineEnd = buffer.indexOf(CRLF)
        if (lineEnd === -1) return
        const command = buffer.slice(0, lineEnd).toUpperCase()
        buffer = buffer.slice(lineEnd + CRLF.length)
        if (command.startsWith('EHLO') || command.startsWith('HELO')) reply('250 falso')
        else if (command.startsWith('MAIL FROM')) reply('250 OK')
        else if (command.startsWith('RCPT TO')) reply(mode === 'reject-rcpt' ? '550 5.1.1 Destinatario rechazado' : '250 OK')
        else if (command === 'DATA') {
          inData = true
          reply('354 Adelante')
        } else if (command === 'QUIT') {
          socket.end('221 Fin' + CRLF)
          return
        } else reply('502 No implementado')
      }
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as net.AddressInfo).port
}

async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise(resolve => server.close(resolve))
  return port
}

async function send(port: number): Promise<unknown> {
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 500,
    greetingTimeout: 300,
    socketTimeout: 1000,
  })
  try {
    await transport.sendMail({ from: 'origen@example.test', to: 'destino@example.test', subject: 'Prueba', text: 'Cuerpo' })
    return null
  } catch (error) {
    return error
  } finally {
    transport.close()
  }
}

describe('fallo de envío conocido o sin confirmar, con nodemailer real (DA-39)', () => {
  it('el servidor acepta: no hay error', async () => {
    expect(await send(await fakeSmtp('accept'))).toBeNull()
  })

  it.each([
    ['conexión rechazada (servidor SMTP caído)', async () => send(await closedPort())],
    ['el servidor no saluda', async () => send(await fakeSmtp('silent'))],
    ['destinatario rechazado (550)', async () => send(await fakeSmtp('reject-rcpt'))],
    ['mensaje rechazado al final de DATA (554)', async () => send(await fakeSmtp('reject-data'))],
  ])('%s: fallo conocido, el token se puede anular', async (_label, attempt) => {
    const error = await attempt()

    expect(error).toBeInstanceOf(Error)
    expect(isDeliveryUnconfirmed(error)).toBe(false)
    expect(deliveryStateFields(error)).toEqual({})
  })

  it('el servidor recibe el mensaje y corta sin responder: no confirmado, el token se conserva', async () => {
    const error = await send(await fakeSmtp('drop-after-data'))

    expect(error).toMatchObject({ code: 'ECONNECTION' })
    expect(isDeliveryUnconfirmed(error)).toBe(true)
    expect(deliveryStateFields(error)).toEqual({ deliveryState: 'unconfirmed' })
  })
})
