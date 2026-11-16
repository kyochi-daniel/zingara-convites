# organizations Specification

## Purpose
Definir criação, leitura, listagem e edição de organizações persistidas pelo administrador autenticado.

## Requirements

### Requirement: Criar organização

O administrador autenticado SHALL criar organização com nome obrigatório, identidade visual e configurações opcionais validadas. A API SHALL persistir no MongoDB e retornar ID, dados e datas.

#### Scenario: Criação válida

- **WHEN** `POST /admin/organizations` recebe `{ "name": "Acme" }` com sessão e CSRF válidos
- **THEN** responde 201 com `{ organization }`, e uma listagem posterior contém a organização.

#### Scenario: Dados inválidos

- **WHEN** o nome está vazio ou contém campos desconhecidos
- **THEN** responde 400 sem criar registro.

### Requirement: Consultar e editar organizações

O administrador SHALL listar, consultar pelo ID e editar campos permitidos. A API SHALL rejeitar IDs inválidos, filtros arbitrários e campos desconhecidos.

#### Scenario: Edição persistida

- **WHEN** `PATCH /admin/organizations/:id` altera o nome com sessão e CSRF válidos
- **THEN** retorna a organização atualizada, e leitura posterior preserva a alteração.

#### Scenario: Organização ausente

- **WHEN** um ID válido não existe
- **THEN** a API responde 404.

### Requirement: Fronteira administrativa

O domínio público de convite MUST NOT encaminhar rotas administrativas nem expor dados de organizações pela API interna.

#### Scenario: Consulta pública administrativa

- **WHEN** um visitante chama `/api/admin/organizations` no domínio de convite
- **THEN** recebe rejeição sem consultar o MongoDB.
