# admin-visual-design Specification

## Purpose

Definir a apresentação responsiva do painel administrativo a partir dos protótipos Figma, sem confundir prévias visuais com recursos operacionais.

## Requirements

### Requirement: Painel responsivo fiel ao protótipo

O painel administrativo MUST apresentar Início, Convidados e Editar evento com estrutura, tokens, componentes e recursos visuais do Figma em larguras mobile e desktop, preservando acessibilidade por teclado.

#### Scenario: Navegação responsiva

- **WHEN** um administrador autenticado abre o painel em desktop ou mobile
- **THEN** a navegação adequada ao tamanho da tela permite alcançar as áreas existentes sem perda de função.

#### Scenario: Dados e ações reais

- **WHEN** o administrador consulta métricas, convidados ou edita um evento
- **THEN** dados e ações suportados seguem os contratos atuais; elementos sem suporte são identificados como demonstração ou ficam desabilitados.
