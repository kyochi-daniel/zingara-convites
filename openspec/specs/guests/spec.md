# guests Specification

## Purpose
Definir contatos de convidados reutilizáveis por organização e sua importação sem envio de mensagens.

## Requirements

### Requirement: Cadastrar e consultar contato

O administrador autenticado SHALL cadastrar contato com nome e telefone internacional E.164 de 8 a 15 dígitos após `+`, email opcional, tags e notas administrativas. O contato SHALL pertencer a uma organização e MAY participar de vários eventos por meio de convites posteriores.

#### Scenario: Cadastro válido

- **WHEN** `POST /admin/organizations/:organizationId/guests` recebe dados válidos com sessão e CSRF
- **THEN** responde 201 com contato persistido.

#### Scenario: Entrada inválida

- **WHEN** telefone inválido ou campo não permitido é enviado
- **THEN** responde 400 sem criar contato.

### Requirement: Busca, paginação e edição com escopo

O administrador SHALL buscar e paginar contatos da organização e editar campos permitidos. A API MUST NOT retornar nem editar contato de outra organização pelo caminho solicitado. A consulta MUST aceitar uma etiqueta exata opcional e calcular o total após aplicar esse filtro.

#### Scenario: Contato de outra organização

- **WHEN** `GET` ou `PATCH` recebe ID de contato válido pertencente a outra organização
- **THEN** responde 404.

#### Scenario: Filtrar por categoria

- **WHEN** o administrador seleciona uma categoria na tela de convidados
- **THEN** a API retorna apenas convidados da organização com essa etiqueta, com total e paginação coerentes.

### Requirement: Prévia e importação CSV

A prévia SHALL identificar linhas inválidas e possíveis duplicidades antes de persistir. A importação SHALL criar apenas linhas explicitamente aceitas e MUST NOT enviar mensagens.

A importação SHALL aceitar `batchId` UUID fornecido pelo cliente e SHALL ser idempotente por organização, `batchId` e linha física. Repetir o lote SHALL devolver contatos já criados e concluir linhas pendentes após falha parcial, sem prometer atomicidade do lote. O cliente SHALL reutilizar o mesmo `batchId` apenas para retry do mesmo arquivo e seleção. Linhas físicas acima de 202 SHALL ser aceitas quando o CSV contém linhas vazias ou campos multilinha, desde que haja no máximo 200 registros e o corpo respeite 16 KiB.

#### Scenario: CSV com erros

- **WHEN** o administrador envia CSV com telefones inválidos ou duplicados
- **THEN** a prévia apresenta números de linha e motivos sem alterar o banco.

#### Scenario: Retry após falha parcial

- **WHEN** a importação de um lote falha após criar parte das linhas e o administrador repete o mesmo arquivo, seleção e `batchId`
- **THEN** retorna contatos existentes e cria somente linhas pendentes, sem duplicar contatos do lote.
