# template-publication Specification

## Purpose
Definir snapshots publicados e versões imutáveis para convites futuros.

## Requirements

### Requirement: Publicar versão de evento

O administrador SHALL publicar o rascunho validado de um evento da organização. A API SHALL criar uma versão imutável crescente e apontar o evento para ela; publicação não cria convites nem envia mensagens.

#### Scenario: Primeira publicação

- **WHEN** `POST /admin/organizations/:organizationId/events/:eventId/template/publish` recebe sessão e CSRF válidos e rascunho completo
- **THEN** cria versão 1, vincula-a ao evento e retorna configuração publicada.

#### Scenario: Edição posterior

- **WHEN** o rascunho é editado após a versão 1 e publicado novamente
- **THEN** cria versão 2 e a leitura da versão 1 permanece igual.

#### Scenario: Evento de outra organização

- **WHEN** a rota contém organização diferente da dona do evento
- **THEN** responde 404 sem publicar.
