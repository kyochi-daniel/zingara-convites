# admin-access Specification

## Purpose
Definir o acesso exclusivo do administrador global, com bootstrap seguro, sessão revogável e proteção de mutações.

## Requirements

### Requirement: Administrador único

O sistema SHALL permitir bootstrap idempotente de apenas um administrador global por comando local seguro. A API MUST NOT oferecer cadastro público.

#### Scenario: Bootstrap repetido

- **WHEN** o comando de bootstrap é executado após existir administrador
- **THEN** mantém o administrador existente sem trocar senha.

### Requirement: Login e sessão revogável

A API SHALL verificar senha Argon2id, emitir JWT com assinatura, expiração, issuer e audience e persistir sessão. Login válido SHALL definir cookie HttpOnly com `SameSite=Lax` e `Secure` em produção. Logout SHALL revogar a sessão no banco e limpar o cookie.

#### Scenario: Login válido

- **WHEN** o administrador envia credenciais válidas para `POST /admin/auth/login`
- **THEN** recebe `{ admin, csrfToken }` e cookie de sessão.

#### Scenario: Credenciais inválidas

- **WHEN** as credenciais não conferem
- **THEN** a API responde 401 sem revelar qual campo falhou.

#### Scenario: Logout

- **WHEN** uma sessão válida chama `POST /admin/auth/logout` com CSRF correto
- **THEN** a sessão é revogada e o cookie apagado; uso posterior do JWT responde 401.

### Requirement: Proteção das rotas

A API SHALL exigir sessão ativa para rotas administrativas, origem permitida e token CSRF para mutações autenticadas. O login SHALL ter limite de tentativas.

#### Scenario: Mutação sem CSRF

- **WHEN** uma sessão válida faz POST ou PATCH administrativo sem `x-csrf-token` correto
- **THEN** a API responde 403 e não altera dados.

#### Scenario: Sessão revogada

- **WHEN** um JWT assinado corresponde a sessão revogada
- **THEN** a API responde 401.
