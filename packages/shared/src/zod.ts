import { z } from 'zod'

// Zod 4 compila los esquemas con `new Function` si puede. En el navegador la CSP de la web no
// permite `eval` (ni debe), y cada intento queda registrado como una violación: se desactiva.
z.config({ jitless: true })

export { z }
