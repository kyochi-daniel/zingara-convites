# templates Specification

## Purpose
Definir layouts seguros e rascunhos configuráveis de convite, com prévia e mídia controlada.

## Requirements

### Requirement: Catálogo e rascunho

O administrador SHALL escolher entre layouts Vue enumerados e editar apenas campos definidos no contrato. A API MUST NOT aceitar HTML, JavaScript, layouts ou variáveis desconhecidas; textos SHALL ser exibidos como texto escapado.

#### Scenario: Configuração válida

- **WHEN** `PUT /admin/organizations/:organizationId/events/:eventId/template` recebe configuração válida com sessão e CSRF
- **THEN** persiste o rascunho e `GET` posterior retorna os campos.

#### Scenario: Código ou variável inválida

- **WHEN** configuração contém campo livre de código, layout não catalogado ou `{{variavel.desconhecida}}`
- **THEN** responde 400 sem alterar o rascunho.

### Requirement: Prévia e mídia

O painel SHALL mostrar preview mobile e desktop com dados de exemplo identificados. Imagens personalizadas SHALL ser recebidas por upload limitado, normalizadas e servidas por ID opaco, sem ler caminhos arbitrários ou URLs externas.

#### Scenario: Upload inválido

- **WHEN** arquivo ultrapassa o limite ou não é imagem decodificável permitida
- **THEN** responde erro sem salvar arquivo acessível.

#### Scenario: Upload válido

- **WHEN** `POST /admin/organizations/:organizationId/assets` recebe PNG/JPEG/WebP válido, sessão e CSRF
- **THEN** responde ID opaco e `GET /media/:assetId` serve o WebP normalizado sem expor caminho local.

#### Scenario: Preview seguro

- **WHEN** o texto contém caracteres com aparência de HTML
- **THEN** o preview os exibe como texto e não executa marcação.
