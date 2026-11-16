# connections Specification

## Purpose
Vincular uma instância UazapiGO existente a uma organização sem expor credenciais.

## Requirements

### Requirement: Vincular instância existente

O administrador SHALL vincular Server URL e token da instância a uma organização. O backend SHALL cifrar o token, validar o destino de rede e restringir leitura e operação à organização vinculada.

#### Scenario: Vínculo válido

- **WHEN** administrador informa URL HTTPS pública e token para organização autorizada
- **THEN** persiste vínculo cifrado e retorna metadados sem token.

#### Scenario: Endereço inseguro

- **WHEN** URL aponta a IP local/privado, contém credenciais ou redireciona para destino não permitido
- **THEN** nenhuma chamada externa é feita e o vínculo é rejeitado.

### Requirement: Diagnosticar e conectar

O backend SHALL consultar estado e limites pelo token da instância e SHALL iniciar conexão somente mediante ação explícita e estado elegível.

#### Scenario: Já conectando

- **WHEN** instância está `connecting` ou `connected`
- **THEN** não chama `POST /instance/connect` novamente.
