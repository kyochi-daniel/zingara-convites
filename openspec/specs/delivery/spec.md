# delivery Specification

## Purpose
Solicitar e executar envio de convites com durabilidade, rastreio e segurança contra duplicação.

## Requirements

### Requirement: Planejar envio aprovado

O administrador SHALL ver destinatário e conteúdo antes de aprovar envio inicial. O sistema SHALL persistir uma solicitação única para o convite e versão e SHALL usar fake no ambiente local.

#### Scenario: Aprovação repetida

- **WHEN** a mesma aprovação é enviada duas vezes
- **THEN** permanece uma solicitação durável, sem duplicar entrega.

### Requirement: Verificar elegibilidade na execução

O worker SHALL reler estado atual de evento, convite, RSVP, consentimento, conexão, janela e limites antes de cada envio. Uma solicitação inelegível SHALL ser suprimida sem chamar o provedor.

#### Scenario: Convite revogado após planejamento

- **WHEN** worker recebe job de convite revogado
- **THEN** não chama o adaptador de envio e registra supressão.

### Requirement: Rastrear resultado incerto

O sistema SHALL guardar tentativa e IDs opacos por parte de mídia/texto. Timeout SHALL resultar em estado incerto até reconciliação; `track_id` SHALL ser apenas correlação.

#### Scenario: Timeout depois da chamada

- **WHEN** o provedor não responde no prazo
- **THEN** worker não repete automaticamente a parte e marca necessidade de reconciliação.
