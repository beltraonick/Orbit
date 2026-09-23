export type Locale = 'en' | 'pt' | 'es'

export const LOCALE_COOKIE = 'orbitops_locale'

export const LOCALES: { value: Locale; flag: string; label: string }[] = [
  { value: 'en', flag: '🇺🇸', label: 'English' },
  { value: 'pt', flag: '🇧🇷', label: 'Português' },
  { value: 'es', flag: '🇪🇸', label: 'Español' },
]

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {
    tagline: 'Workforce Management',
    iAmA: 'I am a…',
    roleEmployee: 'Employee',
    roleEmployeeSub: 'Clock in, view tasks',
    roleAdmin: 'Company',
    roleAdminSub: 'Manage team & projects',
    roleClient: 'Client',
    roleClientSub: 'View project progress',
    roleOwner: 'Admin',
    roleOwnerSub: 'Full platform access',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    forgotPassword: 'Forgot password?',
    signIn: 'Sign In',
    signingIn: 'Signing in…',
    errorGeneric: 'Something went wrong. Please try again.',
    joiningTeam: 'Joining a team?',
    createAccount: 'Create account',
    newBusiness: 'New business?',
    setupCompany: 'Set up your company',
    registerTitle: 'Employee Registration',
    registerSubtitle: 'Enter the invite code your company shared with you',
    registerCompanyHint: 'Setting up a new company?',
    registerCompanyLink: 'Create your company workspace →',
    inviteCodeLabel: 'Invite Code',
    inviteCodeHint: 'Your company admin will share this code with you.',
    fullNameLabel: 'Full Name',
    phoneLabel: 'Phone Number',
    preferredLanguageLabel: 'Preferred Language',
    passwordMinHint: 'Min. 8 characters',
    confirmPasswordLabel: 'Confirm Password',
    creatingAccount: 'Creating account…',
    createAccountBtn: 'Create Account',
    noAccount: "Don't have an account?",
    createAccountLink: 'Create account →',
    alreadyHaveAccount: 'Already have an account?',
    pendingTitle: 'Awaiting Approval',
    pendingAccountCreated: 'Account created successfully',
    pendingBody1: 'Your account is awaiting administrator approval.',
    pendingBody2: "You'll receive access once an administrator reviews and approves your account. Please check back later or contact your supervisor.",
    backToLogin: 'Back to login',
    whatHappensNext: 'What happens next?',
    pendingStep1: 'An administrator reviews your account request',
    pendingStep2: 'You receive approval and gain access to the system',
    pendingStep3: 'Sign in with your credentials to get started',
    backToSignIn: 'Back to Sign In',
  },
  pt: {
    tagline: 'Gestão de Equipe de Obra',
    iAmA: 'Eu sou…',
    roleEmployee: 'Funcionário',
    roleEmployeeSub: 'Bater ponto, ver tarefas',
    roleAdmin: 'Empresa',
    roleAdminSub: 'Gerenciar equipe e projetos',
    roleClient: 'Cliente',
    roleClientSub: 'Ver progresso do projeto',
    roleOwner: 'Admin',
    roleOwnerSub: 'Acesso total à plataforma',
    emailLabel: 'E-mail',
    passwordLabel: 'Senha',
    forgotPassword: 'Esqueceu a senha?',
    signIn: 'Entrar',
    signingIn: 'Entrando…',
    errorGeneric: 'Algo deu errado. Tente novamente.',
    joiningTeam: 'Entrando em uma equipe?',
    createAccount: 'Criar conta',
    newBusiness: 'Nova empresa?',
    setupCompany: 'Configure sua empresa',
    registerTitle: 'Cadastro de Funcionário',
    registerSubtitle: 'Digite o código de convite que sua empresa compartilhou com você',
    registerCompanyHint: 'Quer cadastrar uma nova empresa?',
    registerCompanyLink: 'Crie o espaço da sua empresa →',
    inviteCodeLabel: 'Código de Convite',
    inviteCodeHint: 'O administrador da sua empresa vai te enviar este código.',
    fullNameLabel: 'Nome Completo',
    phoneLabel: 'Telefone',
    preferredLanguageLabel: 'Idioma Preferido',
    passwordMinHint: 'Mínimo de 8 caracteres',
    confirmPasswordLabel: 'Confirmar Senha',
    creatingAccount: 'Criando conta…',
    createAccountBtn: 'Criar Conta',
    noAccount: 'Não tem uma conta?',
    createAccountLink: 'Criar conta →',
    alreadyHaveAccount: 'Já tem uma conta?',
    pendingTitle: 'Aguardando Aprovação',
    pendingAccountCreated: 'Conta criada com sucesso',
    pendingBody1: 'Sua conta está aguardando aprovação do administrador.',
    pendingBody2: 'Você terá acesso assim que um administrador revisar e aprovar sua conta. Volte mais tarde ou fale com o seu responsável.',
    backToLogin: 'Voltar para o login',
    whatHappensNext: 'O que acontece agora?',
    pendingStep1: 'Um administrador revisa o seu pedido de cadastro',
    pendingStep2: 'Você recebe a aprovação e ganha acesso ao sistema',
    pendingStep3: 'Entre com seu e-mail e senha para começar',
    backToSignIn: 'Voltar para o Login',
  },
  es: {
    tagline: 'Gestión de Personal de Obra',
    iAmA: 'Soy…',
    roleEmployee: 'Empleado',
    roleEmployeeSub: 'Marcar hora, ver tareas',
    roleAdmin: 'Empresa',
    roleAdminSub: 'Gestionar equipo y proyectos',
    roleClient: 'Cliente',
    roleClientSub: 'Ver progreso del proyecto',
    roleOwner: 'Admin',
    roleOwnerSub: 'Acceso total a la plataforma',
    emailLabel: 'Correo electrónico',
    passwordLabel: 'Contraseña',
    forgotPassword: '¿Olvidó su contraseña?',
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión…',
    errorGeneric: 'Algo salió mal. Inténtalo de nuevo.',
    joiningTeam: '¿Te unes a un equipo?',
    createAccount: 'Crear cuenta',
    newBusiness: '¿Empresa nueva?',
    setupCompany: 'Configura tu empresa',
    registerTitle: 'Registro de Empleado',
    registerSubtitle: 'Ingresa el código de invitación que tu empresa compartió contigo',
    registerCompanyHint: '¿Registrando una nueva empresa?',
    registerCompanyLink: 'Crea el espacio de tu empresa →',
    inviteCodeLabel: 'Código de Invitación',
    inviteCodeHint: 'Tu administrador de empresa te enviará este código.',
    fullNameLabel: 'Nombre Completo',
    phoneLabel: 'Teléfono',
    preferredLanguageLabel: 'Idioma Preferido',
    passwordMinHint: 'Mínimo 8 caracteres',
    confirmPasswordLabel: 'Confirmar Contraseña',
    creatingAccount: 'Creando cuenta…',
    createAccountBtn: 'Crear Cuenta',
    noAccount: '¿No tienes una cuenta?',
    createAccountLink: 'Crear cuenta →',
    alreadyHaveAccount: '¿Ya tienes una cuenta?',
    pendingTitle: 'Esperando Aprobación',
    pendingAccountCreated: 'Cuenta creada con éxito',
    pendingBody1: 'Tu cuenta está esperando la aprobación del administrador.',
    pendingBody2: 'Tendrás acceso en cuanto un administrador revise y apruebe tu cuenta. Vuelve más tarde o contacta a tu supervisor.',
    backToLogin: 'Volver al inicio de sesión',
    whatHappensNext: '¿Qué sigue?',
    pendingStep1: 'Un administrador revisa tu solicitud de cuenta',
    pendingStep2: 'Recibes la aprobación y obtienes acceso al sistema',
    pendingStep3: 'Inicia sesión con tus credenciales para comenzar',
    backToSignIn: 'Volver a Iniciar Sesión',
  },
}

// Known server-side error strings (from app/actions/auth.ts), translated.
// Anything not in this map is shown as-is (falls back to the original English).
const errorTranslations: Record<string, Record<Locale, string>> = {
  'Email and password are required.': {
    en: 'Email and password are required.',
    pt: 'E-mail e senha são obrigatórios.',
    es: 'Correo electrónico y contraseña son obligatorios.',
  },
  'Invalid email or password.': {
    en: 'Invalid email or password.',
    pt: 'E-mail ou senha inválidos.',
    es: 'Correo electrónico o contraseña inválidos.',
  },
  "We couldn't complete the login right now. Please try again.": {
    en: "We couldn't complete the login right now. Please try again.",
    pt: 'Não foi possível concluir o login agora. Tente novamente.',
    es: 'No fue posible completar el inicio de sesión ahora. Inténtelo de nuevo.',
  },
  "We couldn't complete this request right now. Please try again.": {
    en: "We couldn't complete this request right now. Please try again.",
    pt: 'Não foi possível concluir esta solicitação agora. Tente novamente.',
    es: 'No fue posible completar esta solicitud ahora. Inténtelo de nuevo.',
  },
  'Your account has not been activated yet. Use the activation link sent by your administrator.': {
    en: 'Your account has no password set yet. Ask your administrator to set one from the Employees screen.',
    pt: 'Sua conta ainda não tem uma senha definida. Peça para o seu administrador definir uma na tela de Funcionários.',
    es: 'Su cuenta aún no tiene una contraseña definida. Pida a su administrador que defina una en la pantalla de Empleados.',
  },
  'Your account has been suspended. Contact your administrator.': {
    en: 'Your account has been suspended. Contact your administrator.',
    pt: 'Sua conta foi suspensa. Entre em contato com seu administrador.',
    es: 'Su cuenta ha sido suspendida. Contacte a su administrador.',
  },
  'Please fill in all required fields.': {
    en: 'Please fill in all required fields.',
    pt: 'Preencha todos os campos obrigatórios.',
    es: 'Completa todos los campos obligatorios.',
  },
  'An invite code is required to register.': {
    en: 'An invite code is required to register.',
    pt: 'É necessário um código de convite para se cadastrar.',
    es: 'Se requiere un código de invitación para registrarte.',
  },
  'Passwords do not match.': {
    en: 'Passwords do not match.',
    pt: 'As senhas não coincidem.',
    es: 'Las contraseñas no coinciden.',
  },
  'Password must be at least 8 characters.': {
    en: 'Password must be at least 8 characters.',
    pt: 'A senha deve ter pelo menos 8 caracteres.',
    es: 'La contraseña debe tener al menos 8 caracteres.',
  },
  'Invalid or expired invite code. Please ask your administrator for a valid code.': {
    en: 'Invalid or expired invite code. Please ask your administrator for a valid code.',
    pt: 'Código de convite inválido ou expirado. Peça um código válido ao seu administrador.',
    es: 'Código de invitación inválido o vencido. Pide un código válido a tu administrador.',
  },
  'An account with this email already exists.': {
    en: 'An account with this email already exists.',
    pt: 'Já existe uma conta com este e-mail.',
    es: 'Ya existe una cuenta con este correo electrónico.',
  },
}

export function t(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? dictionaries.en[key] ?? key
}

export function translateError(locale: Locale, message: string): string {
  return errorTranslations[message]?.[locale] ?? message
}

export function getStoredLocale(): Locale {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=(en|pt|es)`))
  return (match?.[1] as Locale) ?? 'en'
}

export function storeLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000`
}
