# automations Specification

## Purpose
Planejar notificações de convites segundo regras explícitas e elegibilidade atual.

## Requirements

### Requirement: Configurar regra

O administrador SHALL configurar ativação, público, horário/deslocamento, texto e limite de execuções para cada tipo previsto, com prévia de destinatários.

#### Scenario: Cobrança de pendentes

- **WHEN** regra de cobrança está ativa antes do prazo de RSVP
- **THEN** só convites ainda pendentes e elegíveis entram no planejamento.

### Requirement: Suprimir envio inelegível

O worker SHALL revalidar versão da regra, RSVP, evento, prazo, opt-out, conexão e limites antes de enviar. Jobs antigos SHALL ser invalidados individualmente.

#### Scenario: Confirmação após agendar cobrança

- **WHEN** convidado confirma antes da execução
- **THEN** cobrança não é enviada.

#### Scenario: Reinício após atraso grande

- **WHEN** worker retoma com lembrete fora da janela de tolerância
- **THEN** registra supressão sem envio tardio em massa.

### Requirement: Respeitar opt-out

O sistema SHALL guardar supressão solicitada pelo destinatário e SHALL impedir novas notificações para ele até revisão autorizada.

#### Scenario: Mensagem de parada explícita

- **WHEN** chega mensagem recebida com palavra inequívoca de parada
- **THEN** suprime envios futuros daquele contato e registra motivo.
