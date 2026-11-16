# rsvp Specification

## Purpose
Permitir resposta pública segura, editável até o prazo e consistente sob repetição e concorrência.

## Requirements

### Requirement: Ler convite sem efeito colateral

GET SHALL apresentar somente os dados necessários do convite e SHALL nunca confirmar, recusar, cancelar ou marcar leitura humana.

#### Scenario: Prévia de robô

- **WHEN** cliente acessa o link via GET
- **THEN** recebe convite e estado atual sem mutação de RSVP.

### Requirement: Registrar RSVP

O portador do token SHALL poder confirmar ou recusar antes do prazo. A API SHALL validar limite e nomes de acompanhantes, tratar repetição idempotente e impedir perda de uma resposta concorrente.

#### Scenario: Confirmação com acompanhantes

- **WHEN** convidado confirma com nomes dentro do limite do convite
- **THEN** persiste resposta e mostra comprovante com total de pessoas.

#### Scenario: Edição antes do prazo

- **WHEN** convidado altera a resposta antes do prazo
- **THEN** substitui a resposta ativa sem duplicar acompanhantes.

#### Scenario: Prazo vencido

- **WHEN** resposta chega após o prazo do evento
- **THEN** não muda o registro.

#### Scenario: Respostas simultâneas distintas

- **WHEN** duas respostas partem da mesma versão atual
- **THEN** apenas uma grava e a outra recebe conflito com oportunidade de recarregar.

### Requirement: Contabilizar estados

O painel SHALL distinguir convites confirmados, recusados e pendentes de pessoas confirmadas incluindo acompanhantes.

#### Scenario: Um acompanhante

- **WHEN** um convite confirma com um acompanhante
- **THEN** o painel conta um convite confirmado e duas pessoas confirmadas.
