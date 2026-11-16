# invitations Specification

## Purpose
Emitir links individuais para convidados de eventos publicados e manter seu vínculo e versão.

## Requirements

### Requirement: Emitir convite individual

O sistema SHALL criar um convite somente quando evento publicado e convidado pertencerem à mesma organização. O convite SHALL fixar a versão publicada e SHALL ser único por evento e convidado.

#### Scenario: Emissão válida

- **WHEN** administrador emite convite para convidado de evento publicado da organização
- **THEN** persiste convite pendente, versão publicada e limite de acompanhantes e fornece link individual somente na resposta autorizada.

#### Scenario: Associação cruzada

- **WHEN** evento ou convidado pertence a outra organização
- **THEN** responde 404 e não cria convite.

#### Scenario: Emissão repetida

- **WHEN** administrador repete a emissão para o mesmo evento e convidado
- **THEN** não cria convite duplicado nem troca a versão fixada.

### Requirement: Proteger o link

O token SHALL ser não enumerável, revogável e expirar. Somente o hash SHALL ser usado para busca; a cópia recuperável SHALL ser cifrada com chave fora do banco.

#### Scenario: Token inválido ou revogado

- **WHEN** alguém usa token inválido, expirado ou revogado
- **THEN** não obtém dados privados nem consegue responder.

#### Scenario: Rotação

- **WHEN** administrador gira o token de um convite
- **THEN** o link anterior deixa de funcionar e apenas o novo é devolvido na resposta autorizada.
