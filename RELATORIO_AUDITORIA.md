# Relatório de auditoria — Conect Transportes

**Data:** 11/11/2026  
**Base:** `Grupo_Conect_OTIMIZADO(2).zip` fornecido nesta conversa.  
**Natureza:** adaptação estática em HTML, CSS e JavaScript do sistema de referência; os dados e movimentos continuam sendo simulações locais.

## 1. Resultado geral

A versão foi construída sobre os arquivos originais, preservando as chaves de armazenamento `grupoConect.*` e os sistemas que já faziam parte do escopo. Não foi feita uma substituição por telas demonstrativas independentes.

Foram acrescentados nesta adaptação:

- **Mercado de ônibus usados:** catálogo demonstrativo separado, pesquisa e filtros, análise de custo de preparação, compra à vista/financiada, entrada no cadastro da Frota, ficha na Garagem, lançamento financeiro, agendamento da inspeção inicial e OS bloqueante até conferência/aprovação.
- **Cadastro de outros cargos:** auxiliares, atendentes, fiscais, supervisores, administrativos e demais funções configuradas; os registros entram na equipe e na folha simulada sem serem tratados como motoristas ou mecânicos para escalas/oficina.
- **Compatibilidade geral com backup Grupo Conect v1:** validação do envelope `localStorage-backup`, prévia dos dados, mesclagem ou substituição, cópia de segurança antes da gravação, conferência de escrita e tentativa de reversão em caso de falha.
- **Prévia e segurança do backup do Visualizador:** resumo de linhas, viagens, histórico e financeiro antes da confirmação, backup geral preventivo e verificações pós-gravação.
- **Capacidade intermunicipal por veículo:** mapa de poltronas e posições em pé usa a capacidade do ônibus selecionado quando a ficha/perfil está disponível; o padrão sem veículo selecionado continua em 44 assentos + 36 em pé.

## 2. Inventário comparativo da Área do Dono

As funções a seguir foram identificadas na marcação HTML e na documentação do projeto original. “Preservado” significa que a ferramenta preexistente permanece na aplicação; “ampliado” identifica integração ou fluxo adicionado nesta adaptação.

| Função original | Funcionamento original identificado | Implementação nesta versão |
|---|---|---|
| Acesso do proprietário | Seletor de perfil para entrar na área administrativa | **Preservado.** A seleção de proprietário continua sendo uma trava de fluxo local; não é autenticação de servidor. |
| Banco — atividade da conta | Saldo e painel de atividade/lançamentos | **Preservado.** Usa o razão financeiro compartilhado pelo aplicativo. |
| Banco — movimentação manual | Pix simulado, transferências, pagamentos/boletos fictícios, saques, depósitos e entradas | **Preservado.** Movimentos são simulados e identificados no extrato. |
| Banco — empréstimos | Solicitação, finalidade, garantia e histórico de crédito empresarial | **Preservado.** Empréstimo é passivo/obrigação, não lucro operacional. |
| Banco — salários | Configuração e pagamento da folha, benefícios e encargos estimados, histórico e comprovantes | **Preservado e ampliado.** Outros cargos cadastrados também aparecem na folha; motorista/mecânico seguem seus cadastros próprios. |
| Banco — ônibus financiados | Contratos, parcelas e pagamentos | **Preservado.** Mercado e aquisição usam o financeiro compartilhado quando aplicável. |
| Banco — IPVA/DETRAN | Lançamento de IPVA por veículo/exercício e cotas | **Preservado.** Vinculado ao veículo cadastrado. |
| Banco — extrato e comprovante | Filtros, pesquisa, exportação CSV, impressão/PDF e comprovante TXT | **Preservado.** |
| Banco — cartões | Bloqueio de cartão empresarial simulado | **Preservado.** |
| Agenda de Frota | Calendário, tarefas, hodômetro, serviços preventivos e compromissos | **Preservado.** Mercado de usados agenda inspeção inicial e cria vínculo com o veículo. |
| Central — visão geral | Indicadores consolidados da operação e da frota | **Preservado.** Painéis consultam os registros dos módulos de origem. |
| Central — abastecimento automático | Parâmetro de abastecimento pré-viagem, condicionado a estoque | **Preservado.** |
| Central — estoque de combustível | Compra de diesel/ARLA, fornecedores simulados, preços, tanques e histórico | **Preservado.** |
| Central — jornada e escala | Cadastro de escala por empresa, motorista, linha, data e horários | **Preservado.** |
| Central — passageiros e reputação | Viagens simuladas, demanda, lotação, manifestações e reputação | **Preservado.** O módulo independente excluído de fluxo por parada não foi reintroduzido. |
| Central — fiscalização | Inspeções de segurança, documentos, acessibilidade e resultado | **Preservado.** |
| Central — seguros e sinistros | Apólices, prêmio, cobertura, sinistros, indenização e histórico | **Preservado.** |
| Jovem Aprendiz — varredura | Análise periódica de frota, Garagem, Agenda, Visualizador, combustível e RH | **Preservado.** Assistente local baseado em regras; não é IA remota nem diagnóstico físico. |
| Jovem Aprendiz — autorizar/recusar | Decisão expressa do proprietário por recomendação | **Preservado.** |
| Jovem Aprendiz — autorização em lote | Seleção de várias recomendações e confirmação do lote | **Preservado.** Ações de folha mantêm confirmação financeira adicional. |
| Jovem Aprendiz — relatórios | Relatórios de ocorrências, análises e respostas | **Preservado.** |
| Jovem Aprendiz — Auditoria de Frota | Prefixos repetidos, fichas incompletas, condição crítica e OS | **Preservado.** |
| Jovem Aprendiz — Conferência de Salários | Funcionários, competência e processamento da folha | **Ampliado.** Inclui outros cargos. |
| Jovem Aprendiz — Relatório Diário | Agenda pendente, OS ativas, ônibus bloqueados e resumo | **Preservado.** |
| Atendimento — propostas recebidas | Lista de leads/propostas e atualização | **Preservado.** |
| Atendimento — escolha de ônibus | Empresa, modelo, prefixo, motorista, horários e confirmação | **Preservado.** Verifica os vínculos e disponibilidade disponíveis no projeto. |
| Atendimento — fretamentos confirmados | Consulta e acompanhamento dos serviços aceitos | **Preservado.** |
| Atendimento — orçamento | Quilometragem, horas, consumo, diesel, pedágios e valor do cliente | **Preservado.** |
| Atendimento — mensagens | Modelos de solicitação, contraproposta, aceite e recusa | **Preservado.** |
| Atendimento — clientes | Diretório e pesquisa de clientes/categorias | **Preservado.** |
| Atendimento — agenda | Atalhos para agenda e acompanhamento | **Preservado.** |
| Atendimento — equipe | Gestão/contratação de motoristas e mecânicos | **Preservado.** |
| Atendimento — outros cargos | Cadastro de colaboradores administrativos e operacionais não motoristas/mecânicos | **Ampliado nesta adaptação.** Cadastro manual entra no quadro de equipe e folha. |
| Atendimento — mercado de peças | Peças solicitadas pela oficina, busca/categoria/família e vínculo a OS | **Preservado.** |
| Atendimento — relatório de oficina | Consulta e exportação CSV dos dados de oficina | **Preservado.** |
| Atendimento — do orçamento ao Caixa | Encaminhamento do orçamento/serviço para os registros de caixa disponíveis | **Preservado.** Operações simuladas. |
| Mercado 0 km | Catálogo, configuração, cotação, proposta e aquisição simulada | **Preservado.** Integrações originais mantidas. |
| Mercado de usados | Não havia mercado independente equivalente na referência enviada | **Adicionado.** Compra simulada, lançamento financeiro, Frota, Garagem, OS e Agenda. Ofertas são dados de demonstração, não anúncios reais. |
| Validador de bordo | Validação funcional de motorista e autorização de partida | **Preservado.** |
| Funções Extras — painel ao vivo | Indicadores de operação | **Preservado.** |
| Funções Extras — projeção de lucro | Simulação de viagens adicionais e projeção financeira | **Preservado.** |
| Funções Extras — reserva de caixa | Consulta de parcelas próximas e reserva necessária | **Preservado.** |
| Funções Extras — auditoria de prefixos e escalas | Detecção de conflitos de frota | **Preservado.** |
| Funções Extras — conflitos de motoristas | Auditoria de sobreposição de turnos | **Preservado.** |
| Funções Extras — ranking de linhas | Comparação de rentabilidade histórica | **Preservado.** |
| Funções Extras — tarifa de equilíbrio | Pagantes, diesel, mão de obra, manutenção, outros custos e margem | **Preservado.** |
| Funções Extras — planejador de diesel | Quilometragem, viagens, consumo, preço e período | **Preservado.** |
| Funções Extras — frota reserva | Necessidade de reserva baseada em frota simultânea e percentual | **Preservado.** |
| Funções Extras — backup da gestão | Prévia e exportação de cópia dos dados de gestão | **Preservado.** |
| Cidades, linhas e serviços | Cadastro de cidade/região, linha e tipo de serviço | **Preservado.** |
| Ônibus por empresa | Cadastro de prefixo/modelo/chassi e frota disponível | **Preservado.** |
| Escala diária | Análise de demanda, capacidade, terreno, diesel, custos e recomendação de veículos | **Preservado.** |
| Resumo e escalas salvas | Salvar/consultar/copiar custos e escalas | **Preservado.** |
| Proposta municipal | Solicitação, negociação de aumento, aceitação e contratos aceitos | **Preservado.** |
| Ferramentas de análise operacional | 13 análises: cadastro, escala, capacidade, terreno, diesel, resultado, tarifa, frota, comparação, contrato municipal, horas de motorista, arquivo e resultado histórico por motorista | **Preservado.** |
| Visualizador — cadastro de operação | Empresa, linha, cidade, ônibus, motorista(s), horários, percurso, tarifa e custos | **Preservado.** |
| Visualizador — velocidade | Tempo real 1×, rápido 10× e turbo 60× | **Preservado.** |
| Visualizador — ocorrências e decisões | Pane, acidente, obra, trânsito, alagamento, decisões e histórico | **Preservado.** |
| Visualizador — substituição | Seleção de reserva, deslocamento, previsão e troca | **Preservado.** Regras de disponibilidade e retenção mecânica mantidas. |
| Visualizador — histórico e finanças | Histórico de viagens, resultado por motorista e lucro/custos operacionais | **Preservado.** |
| Visualizador — arquivo separado | Exportação e restauração do arquivo de operações | **Ampliado.** Prévia, backup geral de segurança e conferência após restauração. |
| Catálogo de veículos | Busca e paginação do catálogo de modelos/chassis | **Preservado.** |
| Financiamentos | Registro de compra, entrada, prazo, juros e vencimentos | **Preservado.** |
| Caixa integrado | Entradas, saídas, categorias, movimentos recentes e CSV | **Preservado.** Compartilha o razão de lançamentos. |
| Garagem — ficha mecânica | Estado do veículo, componentes, condição e histórico | **Preservado.** |
| Garagem — ordens de serviço | Defeitos, gravidade, mecânicos, peças, prazo, custo e status | **Preservado.** Bloqueios operacionais já existentes seguem ativos. |
| Garagem — alertas e panes | Registro e acompanhamento de alertas | **Preservado.** |
| Garagem — equipe de oficina | Mecânicos e especialidades | **Preservado.** Outros cargos são separados da disponibilidade de mecânicos. |

### Funções Dono — as 15 atividades originais

| Função original | Funcionamento original identificado | Implementação nesta versão |
|---|---|---|
| 1. Fretamento Extra | Gera propostas fictícias, estima receita/custos e pode creditar lucro líquido simulado no Caixa após confirmação; evita crédito duplicado | **Preservado.** |
| 2. Desafio de Despacho | Cenários de trânsito, lotação, fadiga e falha pré-viagem com tomada de decisão | **Preservado.** |
| 3. Planejador de Escala | Simula demanda, capacidade, ônibus e intervalos | **Preservado.** |
| 4. Negociação com Fornecedores | Compara três cotações fictícias por desconto, prazo e confiabilidade | **Preservado.** Não altera preço de compra real do diesel. |
| 5. Atendimento VIP | Casos fictícios de atendimento e satisfação | **Preservado.** |
| 6. Marketing de Linhas | Compara campanhas e retorno projetado | **Preservado.** Orçamento projetado não é debitado automaticamente. |
| 7. Leilão de Contratos | Propostas fictícias, preço, margem e probabilidade estimada | **Preservado.** |
| 8. Raio-X da Frota | Consulta indicadores e encaminha para a Garagem | **Preservado.** |
| 9. Avaliação de Usados | Avalia preço, preparação e referência de mercado sem comprar | **Preservado.** Além disso, foi criado Mercado de Usados transacional no simulador, separado. |
| 10. Quiz do Gestor | Perguntas de operação, segurança, manutenção e gestão | **Preservado.** |
| 11. Quebra-cabeça do Terminal | Alocação de ônibus em plataformas com regras de acessibilidade, altura e horários | **Preservado.** |
| 12. Diagnóstico Express | Decisão educativa inicial para sintomas de motor, freios, pneus, pneumática e SCR/ARLA | **Preservado.** Não substitui diagnóstico de oficina. |
| 13. Planejador de Rota e Clima | Estratégias simuladas para clima, congestionamento e restrições viárias | **Preservado.** |
| 14. Contrato Escolar Extra | Solicitações fictícias, tarifa aluno/dia e crédito de margem após conclusão/confirmar | **Preservado.** |
| 15. Publicidade na Frota | Campanhas fictícias, preço, custo e crédito de margem após confirmação | **Preservado.** |

**Exclusões da referência mantidas:** Simular Arrecadação; Controle de manutenção antigo e independente; Fluxo de passageiros por parada; Pontualidade da linha. Não foram reintroduzidos como módulos autônomos. As ordens de serviço, agenda preventiva, controle de passageiros intermunicipal e acompanhamento de operações continuam.

## 3. Integrações preservadas e ampliadas

| Origem → destino | Regra de integração nesta versão |
|---|---|
| Mercado 0 km → Frota/Garagem/Financeiro | Aquisição simulada registra veículo e vínculos previstos pelo fluxo original. |
| Mercado de usados → Banco/Caixa | Entrada ou compra simulada gera lançamento com identificador próprio; financiamento fica em registro de passivo. |
| Mercado de usados → Frota/Garagem/Agenda | Cadastra o ônibus, cria ficha mecânica, OS de inspeção e tarefa inicial na Agenda. |
| Frota → Garagem | Fichas de veículos são sincronizadas por empresa/prefixo/modelo. |
| Frota/Garagem → Visualizador | Veículos bloqueados por OS/pane ou já comprometidos não devem ser escalados como disponíveis. |
| Agenda ↔ Frota/Garagem | Tarefas e hodômetros continuam associados ao veículo; OS e preventivas permanecem na Garagem/Agenda. |
| Contratações → Banco | Motoristas, mecânicos e outros cargos podem ser considerados no quadro de pagamento simulado, com chave/competência para reduzir duplicidade. |
| Contratações → Visualizador/Garagem | Motoristas abastecem escala; somente mecânicos entram na disponibilidade de oficina. |
| Diesel → Banco/Frota/Visualizador | Compras e abastecimentos alimentam estoque, estado por veículo e custo de operação; transferência para tanque não deve ser debitada duas vezes. |
| Visualizador → Banco/Caixa | Viagens concluídas usam registro financeiro identificável e histórico de operação. |
| Intermunicipal → Banco/Caixa | Cada bilhete pago cria uma entrada de receita no razão comum com ID idempotente derivado do ticket; o carregamento também concilia bilhetes de backups antigos sem repetir créditos. Tarifa zero não cria receita. |
| Atendimento → Frota/Agenda/Banco | Propostas e serviços confirmados selecionam veículo/motorista, registram compromisso e valores simulados conforme o fluxo original. |
| Jovem Aprendiz → módulos | Faz leitura transversal e só encaminha ações após autorização; não compra, contrata, paga ou muda operação sozinho. |
| Área do Dono → módulos | Painéis e relatórios consultam as mesmas chaves e registros dos sistemas de origem. |

## 4. Formatos de backup reconhecidos no código original

### Backup geral

Envelope identificado diretamente no `collectBackup()` da referência:

- `app`: `Grupo Conect`
- `format`: `localStorage-backup`
- `version`: `1`
- `exportedAt`: data/hora ISO
- `data`: objeto cujas propriedades são chaves `grupoConect.*` e cujos valores são strings serializadas pelo `localStorage`.

A nova importação valida esse envelope, limita arquivo a 50 MB e 20.000 chaves, valida prefixo e tipo de valor, exibe prévia dos módulos/chaves, permite mesclar ou substituir, gera cópia de segurança antes de escrever, verifica a gravação e tenta reverter o lote se ocorrer erro. Chaves desconhecidas com prefixo compatível são preservadas como dados brutos; não são transformadas automaticamente em telas inexistentes.

### Arquivo independente do Visualizador

Schema identificado no exportador do Visualizador:

- `schema`: `grupo-conect-operation-viewer-archive`
- `version`: `1`
- `app`: `Grupo Conect`
- `createdAt`
- `data.operations`
- `data.normalTripHistory`
- `data.operationCashState`
- `data.virtualDriverCounts`
- `data.dayCount`
- `data.activeDay`

A restauração específica importa operações, viagens e contabilidade operacional, usa identificadores para mesclar sem repetir registros e preserva as demais chaves do aplicativo. A prévia informa contagens e resultado consolidado. A cópia geral preventiva é solicitada antes da escrita e há verificações de leitura posterior.

### Limite do teste de compatibilidade

**Não foi fornecido nesta conversa um arquivo JSON exportado do navegador do Grupo Conect; o ZIP contém o código-fonte, não um backup de dados real.** Por isso, os formatos e campos foram confirmados pela implementação original e os importadores foram construídos para esses envelopes, mas o teste de aceitação com um JSON real — importação e conferência dos dados efetivos em todos os módulos — continua **pendente**. Não seria correto declarar que o teste prático foi aprovado sem esse arquivo.

O backup geral exporta as chaves `localStorage.*` do projeto; imagens/arquivos de horários que estejam guardados separadamente em IndexedDB podem requerer exportação própria e não devem ser considerados garantidamente incluídos no JSON geral.

## 5. Armazenamento, publicação e segurança

- O aplicativo permanece estático e grava no `localStorage` do navegador/origem. Isso significa persistência no mesmo perfil e dispositivo, não sincronização automática entre computadores/celulares.
- O seletor “Pablo”, os diálogos e autorizações são controles de fluxo da simulação. Não constituem autenticação segura, autorização no servidor ou proteção contra edição do armazenamento pelo usuário.
- Não há backend, banco de dados multiusuário, sessão segura ou movimentação bancária real. Valores, contratos, propostas, empréstimos, Pix, compras, passagens e pagamentos são simulações.
- Para publicar estático, hospede juntos `index.html`, `style.css` e `script.js` no mesmo diretório/origem (por exemplo, hospedagem estática HTTPS). Não publique dados privados ou trate a aplicação como sistema financeiro/operacional de produção.
- Para uso real com múltiplos funcionários/dispositivos, é necessária uma camada backend com autenticação, autorização por função, banco relacional, transações, logs auditáveis, rotinas de backup e validação no servidor. Isso não foi criado nesta entrega.

## 6. Otimizações e compatibilidade

- Mantida a navegação por telas do projeto original, com carregamento e atualização seletivos onde já existentes.
- Visualizador mantém a lógica de relógios por timestamps e temporizadores do módulo original; não foi criado timer concorrente para importação.
- A sincronização visual do Visualizador é suspensa quando a aba fica oculta, com reconciliação ao retornar, conforme otimização já presente no ZIP.
- O intermunicipal agora monta assentos e posições em pé pela capacidade do ônibus selecionado/perfil conhecido; padrão de 44 + 36 quando não há seleção/ficha.
- Os módulos excluídos não são inseridos novamente na navegação.

## 7. Testes efetivamente executados nesta adaptação

| Teste | Resultado | Observação |
|---|---|---|
| `node --check script.js` | **Aprovado** | Sem erro de sintaxe após as últimas alterações. |
| IDs HTML | **Aprovado** | 1.127 IDs analisados; nenhum duplicado. |
| Destinos `data-screen` | **Aprovado** | 33 destinos únicos, todos existem como telas. |
| Parsing estrutural do CSS | **Aprovado** | 1.412 nós de regras/at-rules; nenhum erro de parsing após o estilo complementar de placeholder. |
| Capacidade do intermunicipal (perfil explícito 38+42) | **Aprovado** | Resultado 80. |
| Capacidade do perfil rodoviário (46+0) | **Aprovado** | Resultado 46. |
| Integração financeira de passagens e deduplicação | **Aprovado em teste isolado** | Dois bilhetes simulados geraram duas entradas (R$ 20 no total); segunda conciliação gerou zero entradas adicionais. |
| Fallback sem veículo selecionado | **Aprovado** | Resultado padrão 44+36=80. |
| Restauração real com JSON geral exportado do Grupo Conect | **Pendente** | JSON de backup real não foi anexado. |
| Restauração real com JSON de arquivo do Visualizador | **Pendente** | JSON de backup real não foi anexado. |
| Teste visual interativo completo em navegador | **Não concluído neste ambiente** | Chromium está bloqueado pela política do ambiente ao acessar localhost; portanto não afirmo teste manual de cliques nem de aparência em navegador. |
| Teste de integração ponta a ponta descrito no pedido | **Parcial** | A arquitetura e os handlers existentes foram preservados e ampliados, mas não foi executado um fluxo completo de todas as compras/viagens/OS com persistência visual. |

## 8. Pendências e problemas conhecidos

1. A validação definitiva dos importadores exige os dois arquivos JSON reais exportados do Grupo Conect original; sem eles, o aceite de backup fica pendente.
2. As ofertas do Mercado de usados incluídas são cenários fictícios locais; não existe feed de anúncios externos ou consulta de preço de mercado em tempo real.
3. O aplicativo é uma simulação estática com `localStorage`; não atende requisitos de autenticação, auditoria centralizada e sincronização de uma empresa real.
4. Imagens de horários em IndexedDB podem não estar no envelope geral do localStorage.
5. O teste de navegador visual e de integração ponta a ponta não foi possível por bloqueio de Chromium no ambiente da execução.

**Conclusão:** a adaptação preserva as ferramentas inventariadas da Área do Dono e os quatro módulos excluídos continuam fora do escopo. Os recursos adicionados estão descritos acima. O pacote pode ser publicado como simulador estático, mas não deve ser tratado como sistema empresarial de produção nem como compatibilidade de backup aceita antes de validar os arquivos JSON reais.
