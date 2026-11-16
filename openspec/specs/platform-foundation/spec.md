# platform-foundation Specification

## Purpose
Definir a base operacional do monorepo, os limites entre domínios e API e o isolamento do ambiente local.

## Requirements

### Requirement: Health check da API

A API SHALL expor `GET /health` sem autenticação e responder com estado operacional sem dados sensíveis.

#### Scenario: Processo ativo

- **WHEN** um cliente consulta `GET /health`
- **THEN** a API responde 200 com `{ "status": "ok" }`.

### Requirement: Domínios restritos

As interfaces SHALL encaminhar somente rotas explicitamente permitidas à API interna. O proxy público MUST rejeitar caminhos administrativos, URLs arbitrárias e headers de identidade enviados pelo cliente.

#### Scenario: Rota administrativa no domínio público

- **WHEN** um cliente pede `/api/admin/organizations` no domínio de convite
- **THEN** a requisição é rejeitada sem chegar à API interna.

### Requirement: Ambiente local isolável

O setup SHALL atribuir nome de banco, namespace Redis e portas por identificador de worktree sem usar credenciais de produção.

#### Scenario: Duas frentes locais

- **WHEN** duas frentes executam setup com identificadores distintos
- **THEN** recebem bancos, namespaces, portas e arquivos de ambiente distintos.
