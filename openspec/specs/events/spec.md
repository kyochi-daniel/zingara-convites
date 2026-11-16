# events Specification

## Purpose
Definir a gestão de eventos pertencentes a organizações, com datas corretas e política de acompanhantes.

## Requirements

### Requirement: Criar evento em rascunho

O administrador autenticado SHALL criar um evento ligado a uma organização existente. A API SHALL validar nome, descrição opcional, local, endereço, instantes, fuso IANA e política de acompanhantes, e SHALL persistir as datas em UTC mantendo o fuso original. Eventos novos SHALL iniciar em `draft`; após publicação de template válido, o evento SHALL apontar à versão publicada e assumir `published`.

#### Scenario: Evento válido

- **WHEN** `POST /admin/organizations/:organizationId/events` recebe dados válidos com sessão e CSRF
- **THEN** responde 201 com evento em `draft`, ID e datas persistidas.

#### Scenario: Datas inválidas

- **WHEN** término antecede início, prazo de confirmação é posterior ao início ou o fuso é inválido
- **THEN** responde 400 sem criar evento.

#### Scenario: Publicação válida

- **WHEN** um rascunho de template válido é publicado para o evento
- **THEN** o evento fica `published` e referencia a versão criada.

### Requirement: Consulta e edição com escopo

O administrador SHALL listar, consultar e editar eventos da organização indicada. A API MUST NOT retornar ou modificar evento de outra organização pelo caminho solicitado.

#### Scenario: ID de evento de outra organização

- **WHEN** `GET` ou `PATCH /admin/organizations/:organizationId/events/:eventId` usa organização diferente da registrada
- **THEN** responde 404.

#### Scenario: Edição válida

- **WHEN** `PATCH` altera campos permitidos de um evento em rascunho com CSRF válido
- **THEN** a consulta posterior mostra a alteração e preserva os demais campos.
