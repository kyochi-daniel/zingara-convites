# Contribuindo com Zingara Convites

## Fluxo de Git

1. Crie uma branch a partir da base atual: `codex/<assunto>` para trabalho assistido pelo Codex ou `feat/<assunto>`, `fix/<assunto>` e `docs/<assunto>` para contribuições comuns.
2. Mantenha cada mudança focada. Use commits no formato `feat(admin): descrição curta`, `fix(invite): descrição curta` ou `docs: descrição curta`.
3. Abra um pull request com objetivo, mudança de comportamento, telas afetadas, testes executados e capturas de desktop/mobile quando houver UI.
4. Solicite revisão antes de fazer merge. Não inclua `.env`, credenciais, dados reais de convidados nem capturas com informações pessoais.

## Desenvolvimento

Siga [README.md](README.md) para preparar um checkout isolado. Mudanças de comportamento começam com um teste que falha, seguem com a implementação mínima e terminam com a verificação relevante. O comando completo é `pnpm check`; use `pnpm spec:validate`, `pnpm lint`, `pnpm test`, `pnpm typecheck` e `pnpm build` durante o trabalho.

O painel usa Nuxt/Vue e Sass. Preserve os contratos da API e use os tokens visuais compartilhados antes de adicionar estilos avulsos. Registre diferenças entre o Figma e o produto em `docs/` e não apresente dados de demonstração como dados reais.

## Publicação

Pull requests não publicam a aplicação nem enviam mensagens. Deploy e envios reais exigem revisão específica dessas ações.
