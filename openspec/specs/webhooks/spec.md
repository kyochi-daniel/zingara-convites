# webhooks Specification

## Purpose
Receber e consolidar eventos de transporte UazapiGO com durabilidade e isolamento.

## Requirements

### Requirement: Receber evento autenticado

O receptor SHALL limitar payload, vincular o token recebido à instância e persistir uma inbox mínima antes de confirmar recebimento. O processamento de negócio SHALL ser assíncrono.

#### Scenario: Token desconhecido

- **WHEN** webhook contém token sem vínculo
- **THEN** não persiste evento nem altera estado.

#### Scenario: Repetição

- **WHEN** o mesmo recibo chega mais de uma vez
- **THEN** a inbox mantém uma ocorrência lógica e o estado final não duplica.

### Requirement: Consolidar estado de transporte

O sistema SHALL preservar IDs como strings, tolerar eventos fora de ordem e impedir regressão de estado. Transporte SHALL ser separado de RSVP.

#### Scenario: Recibo antigo

- **WHEN** `Sent` chega após `Read` para a mesma mensagem
- **THEN** estado continua `Read`.
