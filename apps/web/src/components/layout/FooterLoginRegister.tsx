import appLogo from '@/assets/appLogo.svg'
import appLogoWhite from '@/assets/appLogoWhite.svg'

function FooterLoginRegister() {
  return (
    <><div className='display: flex justify-center'>
      <img
        src={appLogo}
        alt="EstateForge"
        className="h-72 w-auto mt-5 dark:hidden" />

      <img
        src={appLogoWhite}
        alt="EstateForge"
        className="hidden h-72 w-auto mt-5 dark:block" />
    </div><p className="mt-6 text-center text-xs text-muted-foreground">
        EstateForge · Gestión inmobiliaria con IA
      </p></>
  )
}

export default FooterLoginRegister