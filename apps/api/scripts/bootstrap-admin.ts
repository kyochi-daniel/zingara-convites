import { bootstrapAdmin } from '@zingara/core'

const email = process.env.ADMIN_BOOTSTRAP_EMAIL
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
if (!email || !password) throw new Error('Defina ADMIN_BOOTSTRAP_EMAIL e ADMIN_BOOTSTRAP_PASSWORD no ambiente')
const created = await bootstrapAdmin(email, password)
console.log(created ? 'Administrador criado.' : 'Administrador já existe; senha preservada.')
process.exit(0)
