# Conect Transportes — Gestão Rodoviária Integrada

> Versão adaptada a partir do Grupo Conect enviado em 11/11/2026. Consulte também [`RELATORIO_AUDITORIA.md`](RELATORIO_AUDITORIA.md), que contém o inventário da Área do Dono, a matriz das 15 Funções Dono, os formatos de backup identificados, as integrações e os testes/limitações.

## Início rápido desta versão

1. Extraia o ZIP mantendo `index.html`, `style.css`, `script.js`, `README.md` e `RELATORIO_AUDITORIA.md` na mesma pasta.
2. Abra `index.html` em navegador moderno. Para publicação, envie os arquivos juntos para uma hospedagem estática HTTPS (por exemplo, GitHub Pages ou serviço equivalente).
3. Entre na **Área do Dono** e selecione o perfil de proprietário conforme o fluxo local da interface.
4. Faça um backup geral antes de importar dados ou fazer alterações grandes.
5. Para detalhes de cada módulo, consulte as seções abaixo e a auditoria.

## O que mudou nesta adaptação

- A Área do Dono original e suas ferramentas foram preservadas, conforme a tabela função a função em `RELATORIO_AUDITORIA.md`.
- Foi criado o **Mercado de ônibus usados**, com ofertas de demonstração, avaliação de custo de preparação, aquisição simulada à vista/financiada e integração com Banco/Caixa, Frota, Garagem, OS de inspeção e Agenda. As ofertas não são anúncios reais.
- O cadastro de equipe agora permite outros cargos além de motoristas e mecânicos; esses funcionários também aparecem no quadro da folha simulada.
- O intermunicipal usa capacidade do ônibus selecionado quando sua ficha/perfil oferece essa informação; sem ônibus selecionado, mantém o padrão de 44 assentos + 36 posições em pé. Cada bilhete pago cria entrada única no Caixa/Banco, com conciliação idempotente ao abrir ou restaurar backups antigos.
- A restauração geral e a restauração independente do Visualizador apresentam resumo, fazem cópia de segurança prévia e validam a persistência.

## Backup geral do Grupo Conect original

O importador foi desenvolvido para o envelope encontrado no código original: `app: "Grupo Conect"`, `format: "localStorage-backup"`, `version: 1`, `exportedAt` e `data`, com chaves `grupoConect.*` e valores armazenados como strings. Na tela **Backup e restauração**, selecione o JSON, confira a prévia e escolha **Mesclar** ou **Substituir**. Antes da gravação, o site baixa uma cópia de segurança do estado atual.

- **Mesclar**: atualiza as chaves que vieram no arquivo e preserva outras chaves locais.
- **Substituir**: aplica o conjunto do arquivo e remove chaves locais do Grupo Conect ausentes no arquivo.
- Se a gravação falhar, o importador tenta restaurar os valores anteriores.
- Chaves `grupoConect.*` desconhecidas são preservadas como dados brutos, sem criar módulos novos na navegação.

## Backup específico do Visualizador de Operação

No painel do **Visualizador de Operação**, use **Salvar todas as informações do Visualizador** para exportar o arquivo independente e **Restaurar informações salvas** para importá-lo. O formato original reconhecido é `schema: "grupo-conect-operation-viewer-archive"`, `version: 1`, `app: "Grupo Conect"`, `createdAt` e os dados operacionais/financeiros descritos no relatório de auditoria. A restauração específica não deve substituir Banco, RH, Agenda ou outros módulos; mescla operações, histórico e estado financeiro operacional com deduplicação por identificador.

## Armazenamento e limites importantes

Esta versão continua estática e usa o `localStorage` do navegador/origem. Os dados ficam no perfil e dispositivo em que foram registrados; não há sincronização automática entre celular e computador. O seletor “Pablo” e as confirmações são controles locais da simulação, não autenticação segura. Pix, empréstimos, folha, compras, contratos, passagens e movimentos são fictícios. Para uma operação real multiusuário, é necessário desenvolver backend, autenticação segura, banco de dados, permissões e logs no servidor.

**Compatibilidade de backup ainda precisa de aceite com arquivo real:** nesta conversa foi enviado o código-fonte ZIP, mas não os dois arquivos JSON exportados do navegador do Grupo Conect. Os formatos foram identificados no código-fonte e os importadores implementados para eles; o teste de aceitação com JSON real e conferência dos dados restaurados permanece pendente. Imagens ou arquivos em IndexedDB podem precisar de exportação própria.

---

## Notas operacionais herdadas do projeto de referência

O conteúdo a seguir registra particularidades e orientações que já existiam no Grupo Conect original e continuam relevantes para os módulos preservados.

## Abrir e iniciar viagem
1. Abra `index.html` em um navegador moderno.
2. A página inicial apresenta o menu principal.
3. Selecione empresa, motorista, modelo do ônibus e prefixo para iniciar uma viagem normal.

## Iniciar viagem
- Selecione empresa, motorista, modelo do ônibus e prefixo.
- Empresas ativas no seletor: **Progresso, Viação Cedro, Viação Conecta, Transportes Transportes e Galaxy Transportes**. A frota base da Progresso e da Viação Cedro já está disponível; para as outras empresas, cadastre modelos e prefixos na Área do Dono. O cadastro da frota não prende o veículo a uma cidade/linha nem pede tanque, lotação ou consumo fixos.
- Progresso mantém os prefixos anteriores 80, 195–199, 200–207, adiciona Apache Vip III MB OF-1721 (180) e Torino MB OF-1519 (211–213), e utiliza Mascarello Gran Micro S3 (208–210) sem a descrição “sem ar”.
- Viação Cedro: Spectrum Road (2500–2501), Audace (2502–2510), Gran Via (2511–2513), Viaggio G7 1050 (2514–2520), Neobus N10 (2521–2522), Apache Vip IV (2523–2525), Torino 2007 (2526), Apache Vip II (2527) e Paradiso G6 (2529–2533). O prefixo 2528 não foi cadastrado porque não foi informado.

## Calculadora de diesel
- Depois de iniciar a viagem, selecione o chassi/motorização.
- A capacidade do tanque é preenchida automaticamente com base na lista configurada no site.
- Informe a porcentagem inicial e a porcentagem final/atual do painel.
- O site calcula os litros estimados consumidos, o combustível restante e o custo de diesel ao preço inicial de R$ 7,99/L (editável).
- O cálculo presume que não houve abastecimento entre as duas medições. Se a porcentagem final for maior que a inicial, o site solicita rever as medições.

### Capacidades de tanque cadastradas
- **Mercedes-Benz:** OF-1722M (300 L); OF-1724L/OF-1724 (300 L); OF-1726L/OF-1726 (300 L); OF-1721/OF-1721L (300 L); OF-1619 (300 L); OF-1519 (250 L); LO-916 (150 L); LO-915 (150 L).
- **Volkswagen:** 17.260 ODS (275 L); 17.230 ODS (275 L); 17.230 EOD (275 L); 15.190 ODS (275 L); 14.190 ODS (275 L); 9.160 S (150 L).

## Registros e relatórios
- Selecione/crie Dia 1, Dia 2, Dia 3 etc.; viagens finalizadas são salvas no dia selecionado.
- O relatório de viagem contém empresa, motorista, ônibus/prefixo, chassi, nível inicial/final do tanque, passageiros, arrecadação, diesel e resultado.
- **Copiar relatório do dia** copia os totais e o detalhamento das viagens daquele dia.
- Horários podem ser adicionados como fotos e ficam armazenados no navegador.

## Arquivos
- `index.html`: estrutura e telas.
- `style.css`: aparência e adaptação para celular.
- `script.js`: lógica, integrações, armazenamento, histórico e relatórios.
- `RELATORIO_AUDITORIA.md`: inventário da Área do Dono, integrações, backups e testes desta adaptação.

## Observações importantes
- O histórico e as fotos são locais ao navegador/aparelho; eles não são sincronizados entre dispositivos.
- Os valores de tanque e a porcentagem do painel são estimativas. O resultado financeiro desconta apenas o diesel informado e não inclui salários, manutenção, pedágios ou outras despesas.
- Para atualizar um repositório já publicado, substitua `index.html`, `style.css`, `script.js`, `README.md` e `RELATORIO_AUDITORIA.md` pelas versões desta pasta e envie um novo commit.


## Grupo Conect AI e recursos extras
- Abra **Consultar Grupo Conect AI** no controle diário. A previsão usa médias das viagens registradas no dia selecionado.
- O padrão é exigir pelo menos 3 viagens; é possível aumentar o mínimo. Sem esse mínimo, o sistema bloqueia a projeção.
- Informe os horários/linhas planejados e quantas viagens ainda espera fazer. Passageiros e litros de diesel são preenchidos com os totais registrados, mas podem ser ajustados para refletir o painel.
- A previsão estima lucro e diesel para o restante do dia, mas não é garantia e não inclui despesas além do diesel informado. O nome “AI” identifica a ferramenta; o cálculo é local e baseado em médias, sem conexão a um serviço de inteligência artificial externo.

## Três recursos úteis adicionados
1. **Exportar CSV:** baixa os registros do dia selecionado para abrir em planilha.
2. **Pagantes para cobrir o diesel:** mostra quantos passageiros pagantes seriam necessários para arrecadar o custo de diesel da viagem atual.
3. **Conferência de dados:** valida chassi, porcentagens do tanque e informações da viagem antes de finalizar; alerta quando o nível final é maior que o inicial ou quando nenhum passageiro foi informado.

## Calculadora de tarifa e três ferramentas extras
- **Calcular tarifa:** informe a quilometragem total do percurso que deseja calcular, consumo médio observado em km/L, preço do diesel, média de pagantes e, opcionalmente, outros custos e uma margem. O site exibe o custo estimado de diesel, o mínimo por pagante para cobrir apenas o combustível e uma referência de tarifa com os extras informados.
- **Planejar abastecimento:** converte a diferença entre nível atual e desejado em litros e custo estimado.
- **Estimar duração da linha:** usa distância, velocidade média e duração/quantidade das paradas.
- **Checklist pré-viagem:** registra os itens marcados e permite copiar o checklist para uma anotação.

Essas ferramentas mantêm os dados localmente no navegador usado. A calculadora de tarifa não é um sistema oficial de definição de preço: ela não consegue estimar a tarifa completa sem premissas sobre consumo, pagantes e custos. O resultado é apenas uma referência matemática baseada nos dados preenchidos.

## Dez ferramentas adicionais
- Diário de bordo: registra hodômetro inicial/final e calcula a distância percorrida.
- Histórico de abastecimentos: salva litros, preço, custo, veículo e hodômetro.
- Consumo real do ônibus: calcula km/L, L/100 km e custo por quilômetro.
- Meta de arrecadação: estima o que falta e quantos pagantes seriam necessários.
- Gerador de horários: gera uma grade de saídas por intervalo e permite copiá-la.
- Calculadora de turno: calcula tempo entre entrada/saída, descontando intervalo.
- Registro de ocorrências: guarda eventos com data, veículo, prioridade e descrição.
- Checklist de fim de viagem: salva a conferência e permite copiar o checklist.
- Comparar linhas: compara receita estimada menos diesel em duas linhas.
- Backup e restauração: exporta/importa os dados armazenados no localStorage em JSON.

Os dados ficam no navegador/aparelho atual. O backup JSON não inclui fotos salvas no IndexedDB. Faça cópias de segurança regulares. Estimativas são informativas e não substituem os procedimentos oficiais da empresa.

### Limite de uso local
O histórico é armazenado no navegador deste dispositivo. O backup exporta os dados do `localStorage` pertencentes ao Grupo Conect; as fotos dos horários usam armazenamento de imagens separado e precisam ser guardadas à parte. Teste a restauração com cuidado e baixe um backup atual antes de importar outro.


## Mais oito funções operacionais
1. **Despesas operacionais:** guarda gastos de pedágio, estacionamento, lavagem, peças e outras categorias, com soma acumulada e relatório copiável.
2. **Inspeção de pneus:** registra pressão medida e compara com a referência e tolerância informadas pelo usuário; use sempre a referência técnica da frota/fabricante.
3. **Registro de limpeza:** registra data, veículo, itens de limpeza concluídos e pendências.
4. **Validade de documentos:** salva datas de vencimento e mostra alertas de vencidos, vencendo em até 30 dias ou em dia.
5. **Passagem de turno:** registra motorista que entrega/recebe, nível de tanque, hodômetro e observações.
6. **Achados e perdidos:** registra item, local, data, veículo e situação de encaminhamento. Evite guardar dados pessoais desnecessários.
7. **Planejador de paradas:** organiza paradas por linha e soma os minutos de permanência estimados.
8. **Conferência de arrecadação:** compara a receita esperada pelo número de pagantes e tarifa com dinheiro, Pix e cartão/ outros meios informados.

Os novos registros usam armazenamento local com chaves `grupoConect.*` e entram no backup JSON do site. Eles permanecem apenas no navegador/aparelho em uso e não sincronizam entre dispositivos automaticamente. Os indicadores são ferramentas de apoio; inspeções e decisões operacionais devem seguir os procedimentos oficiais da empresa.


## Gerador de documentos dos ônibus
- Acesse no menu inicial **Gerar documentos dos ônibus** e selecione **Pablo** para liberar o formulário da interface. Os outros nomes veem uma mensagem de acesso não liberado.
- Preencha tipo de documento, data, empresa/prefixo, situação do ônibus, marca e modelo da carroceria, ano de fabricação e ano-modelo da carroceria, marca/modelo do chassi e respectivos anos, além de placa, RENAVAM, VIN, combustível, tanque, capacidade de passageiros, hodômetro, ar-condicionado, acessibilidade e observações.
- O botão **Gerar ficha do ônibus** cria e salva uma ficha interna neste navegador. Você pode revisar a ficha, copiar o texto, baixar TXT ou imprimir/salvar em PDF pelo navegador. As fichas ficam disponíveis em **Fichas geradas** e podem ser abertas, baixadas, impressas ou excluídas.
- As fichas são registros internos digitados pelo usuário; elas **não substituem** CRLV, CRV, licenciamento nem outros documentos oficiais de trânsito. Confira todos os dados com os documentos originais antes de usar a ficha.
- **Limite importante de acesso:** o projeto usa HTML/JavaScript estático. A seleção de Pablo funciona como bloqueio visual da interface, não como autenticação segura. Quem puder abrir o código-fonte do site público poderá contornar a restrição; dados confidenciais exigem login e autorização no servidor.
- As fichas são salvas no `localStorage` com uma chave `grupoConect.*`, por isso entram no backup JSON. Elas ficam no navegador/aparelho atual e não sincronizam automaticamente com outros aparelhos.


## Atualização operacional (2026-10-24)
- Preço inicial do diesel atualizado para **R$ 7,99/L**.
- Calculadora de tarifa ampliada para incluir mão de obra, manutenção/pneus por km, custos fixos, outros custos, tributos e margem-alvo. Os padrões são ilustrativos e devem ser ajustados.
- **GPS manual de paradas**: salva o ponto e horário registrados pelo usuário; não utiliza GPS real nem sincroniza automaticamente entre dispositivos. Na interface, só o perfil Pablo pode editar.
- **Operação intermunicipal**: registro por dia, pagantes/gratuidades, contador de catraca, mapa de poltronas, maquininha/QR fictícios, relatório diário e impressão de passagem simulada. Não processa dinheiro real.
- **Área do Dono**: cadastro local de empresas/cidades/linhas/ônibus; cálculo de escala com passageiros, gratuidades, km, terreno, consumo, custos e tarifa de equilíbrio; projeção mensal e minuta municipal fictícia.
- Os novos dados usam chaves `grupoConect.*` e fazem parte do backup JSON existente.

### Observações importantes
O site estático do GitHub Pages não fornece privacidade real por seleção de perfil; para segurança real é necessário login e banco em servidor. Os dados `localStorage` ficam no navegador do aparelho e não sincronizam. Contratos, QR codes, pagamentos, GPS e aprovação de venda são recursos de simulação e não substituem serviços reais nem documentos oficiais.

## Atualização da Área do Dono: escala, operação, mercado, finanças e caixa (24/10/2026)

### Escala por dia da semana
- Selecione data e dia da semana (segunda a domingo), cidade, linha, empresa, ônibus e dados operacionais.
- A sugestão de demanda procura escalas salvas para o mesmo dia da semana, cidade e linha, usando a média de passageiros, gratuidades e partidas/dia. Se não houver histórico, o sistema avisa e usa os valores que você preencher manualmente.
- O cálculo de ônibus e custos é uma estimativa de simulação. Terreno, consumo, custo de pessoal, manutenção, preço do diesel e custos fixos são premissas editáveis.

### Visualizador de Operação
- O cadastro pode puxar ônibus e prefixos da frota ou das escalas salvas, e permite completar cidade, linha, horário, duração e dia de operação.
- Há três turnos de motorista (manhã, tarde e noite). O número de motoristas virtuais por empresa pode ser configurado de 3 a 60.
- A linha mostra estado operacional e animação verde após iniciar. O simulador pode gerar uma ocorrência com probabilidade de 10%. Para cada tipo de ocorrência há cinco respostas prontas; a escolha é registrada no histórico.
- As respostas são sugestões de jogo/organização, não instruções oficiais de segurança. Em situações reais, deve-se seguir a central da empresa, as autoridades e os procedimentos de emergência.

### Mercado de ônibus (catálogo ampliado)
- Catálogo de 80 modelos/configurações, com 20 por página, pesquisa por modelo, chassi, categoria, tração, lotação e configuração, além de simulador de financiamento.
- Cada ficha abre detalhes com dimensões aproximadas (comprimento × largura × altura), quantidade sentada/em pé e total estimado, odômetro simulado, combustível, capacidade de tanque/bateria, consumo de referência, tração/eixos, portas, câmbio, ar-condicionado e nota de acessibilidade.
- Preços e quilometragens são fictícios para o jogo, e capacidades/dimensões/configurações são aproximadas. Não são anúncios ativos nem dados de homologação da unidade real. Em especial, a lotação em pé é uma estimativa visual do simulador e não indica capacidade legal; confirme documentação, versão, chassi e carroceria reais.
- Fontes oficiais para conferir famílias e dimensões de versões: Marcopolo Torino https://onibus.marcopolo.com.br/produtos/urbanos/torino ; Marcopolo Paradiso G8 1800 DD https://onibus.marcopolo.com.br/produtos/marcopolo-g8/paradiso-g8-1800-dd ; Caio Apache VIP https://caio.com.br/produto/apache-vip-9.html ; Mascarello Granvia https://mascarello.com.br/produto/granvia/ ; Volare https://www.volare.com.br/ ; Comil https://www2.comilonibus.com.br/produtos ; Busscar https://busscar.com.br/produtos/ .

### Financeiro e caixa
- Registre ônibus financiados com modelo, chassi, ano, prefixo, valor, entrada, quantidade de parcelas, taxa mensal e vencimento. A parcela é estimada por amortização mensal; juros e prestações reais dependem do contrato efetivo.
- O sistema registra parcelas pagas e restantes, multa/juros de atraso conforme as taxas preenchidas e o histórico de pagamentos.
- Para pagar parcela, o saldo calculado do caixa precisa cobrir o valor total. O caixa soma os valores de receitas e diesel encontrados nos registros de viagem, mais entradas e saídas manuais e pagamentos de financiamento.
- O saldo pode ficar negativo se os custos registrados forem superiores às receitas. Antes de registrar uma entrada, confirme se ela representa dinheiro disponível no cenário; não conte uma receita futura como saldo já recebido.
- O sistema é um simulador local para OMSI 2: não integra bancos, não realiza pagamentos reais, não consulta cotações de crédito, não autentica usuários com segurança e não sincroniza dados entre dispositivos. Use backup JSON regularmente.


## Correções do GPS e sistema intermunicipal (GPcntv9)

- O GPS manual tem modo de consulta e modo de edição visual de Pablo. A seção “Linhas cadastradas na operação” lê as linhas registradas no Visualizador de Operação e permite preencher ônibus/linha para registrar ou editar a última parada. O histórico também permite editar e excluir registros.
- O painel intermunicipal é independente de “Iniciar viagem” municipal. Agora o site abre no menu principal e o usuário acessa o módulo intermunicipal diretamente.
- O mapa usa a capacidade do ônibus selecionado quando a ficha/perfil do modelo está disponível. Sem veículo selecionado, o padrão é 44 poltronas numeradas e 36 posições em pé (80 pessoas). Posições vendidas ficam bloqueadas no dia correspondente.
- A maquininha tem visual de terminal físico ilustrativo, tela de status, teclado, botão de aproximação simulada, comprovante aprovado, QR fictício e impressão para PDF. Nenhuma cobrança real ocorre.
- Dias, contadores, posições vendidas e passagens são salvos em `localStorage` no navegador. Cada passagem com tarifa positiva gera um lançamento único de receita no Caixa/Banco; ao carregar backups antigos, bilhetes sem lançamento são conciliados pelo ID. Os dados não sincronizam automaticamente entre aparelhos.

## Publicar no GitHub Pages

Extraia o ZIP e envie `index.html`, `style.css`, `script.js`, `README.md` e `RELATORIO_AUDITORIA.md` diretamente para a raiz do repositório (não envie apenas o arquivo ZIP nem deixe os arquivos dentro de uma subpasta). Em **Settings → Pages**, selecione **Deploy from a branch**, branch `main` e pasta `/(root)`. Aguarde o Pages concluir a publicação e abra o endereço do repositório.


## Área do Dono: rotas, escala recomendada e contratos municipais

- A seleção de início de viagem agora apresenta veículos pré-cadastrados da Progresso e da Viação Cedro, além de veículos que forem cadastrados na Área do Dono para as demais empresas ativas: Viação Conecta, Transportes Transportes e Galaxy Transportes.
- A lista da Viação Cedro inclui os prefixos 2500–2501, 2502–2510, 2511–2513, 2514–2520, 2521–2522, 2523–2525, 2526, 2527 e 2529–2533. O prefixo 2528 não foi criado porque não foi informado.
- Progresso mantém seus cadastros anteriores, remove a expressão “sem ar” do Gran Micro S3 e adiciona o Apache Vip III MB OF-1721 prefixo 180 e o Torino MB OF-1519 prefixos 211–213.
- O botão “Colinha” orienta apenas os quatro módulos pedidos: GPS, sistema de parcelas, caixa e Área do Dono.
- Cidades e rotas do usuário aparecem como sugestões de preenchimento. Os dados continuam no armazenamento local do navegador.


### Colinha da Operação de Linha
- Dentro do Visualizador de Operação há um botão **Colinha da operação de linha**, acessível também durante uma ocorrência.
- O guia oferece passos de simulação para acidente/via bloqueada, falha mecânica, obra, trânsito e alagamento/mau tempo, além de explicar como registrar a decisão ou manter a linha parada.
- A Colinha geral também ganhou uma quinta seção com um atalho para o Visualizador de Operação.
- A chance de 10% é um sorteio fictício do jogo; orientações para ocorrências reais devem seguir os procedimentos da empresa e das autoridades.


## Revisão de estabilidade — GPcntv9

Esta revisão corrige a inicialização das chaves de armazenamento da Área do Dono, para o acesso do Pablo não falhar ao abrir os módulos. Também mantém o GPS manual liberado somente no modo Pablo e melhora a explicação dos controles de passageiros do setor intermunicipal. Os botões de incremento continuam respondendo ao toque; quando a lotação simulada de 80 pessoas for atingida, o site explica o limite, em vez de deixar o botão aparentemente inativo.

Na Área do Dono, o fluxo foi separado em três partes:

1. **Cidades, linhas e serviços:** cadastre município/região, nome da linha e tipo de operação. As rotas podem ser reutilizadas na escala ou para solicitar uma proposta municipal.
2. **Frota disponível:** cadastre cada veículo da empresa por prefixo, modelo e chassi opcional. A linha não fica vinculada permanentemente ao ônibus e não há formulário fixo para capacidade, tanque, consumo ou tarifa.
3. **Escala diária:** informe data, empresa, rota, tipo de serviço (ou detecção automática), passageiros, frequência, km, tempo, terreno e custos. O sistema ranqueia os ônibus livres naquele dia levando em conta tipo de serviço, capacidade aproximada, quilometragem e consumo. O resultado mostra a recomendação, as premissas e até três alternativas quando há veículos livres. Capacidade e consumo são estimativas de simulação e devem ser conferidos no veículo real.
4. **Contrato municipal:** usar uma rota cadastrada preenche município/linha, mas também é possível digitar cenário manual. “Solicitar proposta à prefeitura” gera uma oferta simulada com base no município, no tipo de serviço e nos custos/receita estimados. “Pedir aumento da proposta” faz uma contraproposta com probabilidade inferior a 100%; a prefeitura pode aceitar ou recusar. A oferta original permanece disponível caso recusem o aumento. “Aceitar proposta” registra o contrato simulado no histórico local. As premissas detalhadas são opcionais e começam com valores de exemplo.

Validações realizadas nesta versão: sintaxe JavaScript; IDs HTML sem duplicidade e referências literais de elementos existentes; destinos de navegação; teste no navegador de teste para acesso do Pablo; listagem da frota-base; cadastro independente de cidade/linha e de veículo; recomendação automática de ônibus urbano e rodoviário; atalhos de rota para escala e proposta municipal; gravação manual de parada no GPS; contadores, tarifas editáveis, mapa 44+36 e venda fictícia de passagem; lançamento no caixa e cadastro/pagamento de parcela simulada; proposta municipal aceita e recusada em simulações controladas; busca do mercado e atalho da Colinha para a operação de linha. Dados de teste foram usados apenas num navegador isolado, não incluídos no pacote final.

## Nova função: lucro histórico por motorista na Operação de Linha

1. Na calculadora de viagens normal, ao iniciar a viagem, preencha **Cidade da linha** e **Nome ou número da linha**. Exemplo: cidade `Nova Friburgo`, linha `32 Nova Suíça`.
2. Finalize a viagem normalmente para registrá-la no histórico do dia. A viagem salva contém empresa, cidade, linha, motorista, arrecadação, custo de diesel e resultado estimado.
3. Na **Área do Dono → Visualizador de Operação**, cadastre a operação com a mesma empresa, cidade e nome/número da linha e defina os motoristas por turno.
4. No cartão da linha, use **Ver lucro histórico por motorista**. A análise consulta todos os dias salvos no histórico normal, compara empresa + cidade + linha e apresenta por motorista o total e a média do resultado das viagens correspondentes.
5. Para evitar mistura de linhas, a cidade e a linha são comparadas sem diferenciar maiúsculas, acentos e pontuação. A empresa e o nome do motorista precisam corresponder.
6. Se houver viagens antigas sem cidade/linha, abra o histórico da calculadora normal e toque em **Identificar cidade/linha para análise** na viagem correta. Preencha cidade e linha e salve. O sistema não adivinha a rota antiga; após identificá-la manualmente, ela pode entrar na análise.

**Como interpretar o valor:** `resultado da viagem = arrecadação dos passageiros pagantes − custo do diesel registrado`. É uma estimativa antes de outros custos, não o salário ou a comissão pessoal do motorista. O relatório usa todos os dias do histórico, independentemente do Dia selecionado na calculadora.



## Operação de linha com cronômetro e lucro ao vivo

No Visualizador de Operação, informe o tempo de cada percurso e selecione a velocidade de simulação:
- **1× Tempo real:** 32 minutos de percurso levam 32 minutos reais.
- **10× Rápido:** 32 minutos de percurso levam 3 min e 12 s reais.
- **60× Turbo:** 32 minutos de percurso levam 32 segundos reais.

A cada percurso concluído o simulador registra uma viagem e soma arrecadação, custo de diesel e resultado ao motorista do turno correspondente. A tela exibe o cronômetro, viagens realizadas, lucro acumulado e resultado por motorista. A operação pode ser pausada e retomada. O progresso é baseado em carimbos de data no armazenamento local; ao reabrir a página, os percursos cujo tempo já passou são recuperados.

O simulador pesquisa o histórico das viagens normais usando empresa, cidade e linha. Se houver registros, usa suas médias de arrecadação e diesel. Se ainda não houver histórico compatível, usa os valores de pagantes, tarifa e custo do diesel informados no cadastro da operação, deixando claro que são estimativas.

**Integração automática com o Caixa:** o resultado líquido de cada viagem simulada passa a aparecer no Caixa como um movimento automático de lucro ou prejuízo da Operação de Linha. O saldo disponível inclui esses resultados sem precisar lançar nada manualmente. O lançamento informa empresa, cidade, linha, prefixo, motorista e número da viagem; ele não é apagado ao remover a linha da tela de operação. A integração impede duplicações quando o site atualiza ou recupera viagens após reabertura. Operações antigas recebem um lançamento inicial com o resultado acumulado antes da instalação desta correção, e as viagens seguintes passam a ser detalhadas individualmente. O histórico normal de viagens continua separado.

O relógio do motorista considera manhã das 06:00 às 11:59, tarde das 12:00 às 17:59 e noite das 18:00 às 05:59, usando o horário inicial da operação e os minutos simulados decorridos.


## Operação de linha em ciclo diário (05:00–23:00)
- A primeira partida pode ser definida entre 05:00 e 23:00.
- O sistema repete as viagens em ciclos diários: não agenda novas partidas entre 23:00 e 05:00.
- Uma viagem que já saiu antes do encerramento pode terminar depois das 23:00; a próxima partida só ocorre a partir das 05:00.
- O ciclo segue automaticamente dia após dia até Pablo pausar, resolver uma ocorrência que pare a linha ou remover a operação. O contador exibido na tela leva em conta a velocidade escolhida (1×, 10× ou 60×).
- Cada viagem concluída gera receita, custo de diesel e resultado acumulado para o motorista correspondente ao turno da partida. O ritmo real é controlado por 1×, 10× ou 60×.


## Correção: lucro automático da Operação de Linha no Caixa

- O Caixa mostra um indicador próprio **Lucro líquido das operações em linha** e adiciona esse resultado ao saldo disponível, para que possa financiar despesas e parcelas.
- Cada viagem concluída gera uma linha automática no extrato; lucro entra como entrada e prejuízo como saída. A linha informa rota, empresa, motorista, prefixo e número da viagem.
- Os lucros são sincronizados a partir dos totais cumulativos da operação. Se o site ficar fechado e recuperar várias viagens, os registros recentes aparecem individualmente e qualquer diferença que não esteja no log rotativo é registrada como recuperação consolidada.
- Os últimos 5.000 movimentos detalhados da operação são mantidos no estado de caixa. O lucro acumulado continua no total mesmo quando há mais movimentos antigos que o limite de detalhes; o extrato mostra um resumo do saldo acumulado anterior.
- Os resultados simulados são contabilizados uma única vez, mesmo após atualizar a página, pausar/retomar ou remover uma operação.


## Funções Extras do Dono (10 ferramentas)

Na Área do Dono, selecione **Pablo** e abra **Funções Extras do Dono**. O painel contém dez ferramentas com tutoriais expansíveis (“Para que serve e como usar”):

1. **Painel de operação ao vivo:** linhas em andamento, viagens concluídas, arrecadação, diesel, lucro e principais resultados por motorista.
2. **Projeção de lucro:** estima o resultado se uma operação completar mais viagens; é previsão e não altera o caixa.
3. **Reserva de caixa para parcelas:** compara o saldo disponível com parcelas vencidas ou próximas.
4. **Auditoria de prefixos e escalas:** procura prefixos repetidos em escalas no mesmo dia e em operações ativas.
5. **Conflitos de motoristas:** procura o mesmo motorista em mais de uma linha ativa no mesmo turno.
6. **Ranking de rentabilidade:** compara o resultado médio das linhas identificadas no histórico de viagens normais.
7. **Tarifa de equilíbrio:** calcula tarifa necessária por pagante para cobrir custos e a margem desejada.
8. **Planejador de diesel:** estima consumo/custo diário e mensal por km, quantidade de viagens, eficiência e preço.
9. **Frota reserva:** estima quantos veículos extras manter para cobrir o pico de operação.
10. **Backup de segurança:** exporta as chaves de dados do Grupo Conect em JSON.

Os cálculos são recursos da simulação. As projeções não registram dinheiro automaticamente; o caixa continua sendo atualizado pelos módulos já existentes. Os dados ficam no navegador local. O backup JSON abrange as chaves de `localStorage` com prefixo `grupoConect.`; fotos que possam estar guardadas separadamente no IndexedDB podem exigir exportação à parte.

## Atendimento Online (turismo, fretamento e escolar)
- Abra **Área do Dono → Pablo → Atendimento Online** para entrar no aplicativo de celular cenográfico Grupo Conect.
- A base gera **1.232 perfis potenciais de clientes** (44 perfis-base distribuídos por 28 cidades de 20 estados), incluindo escolas, empresas, famílias, agências, associações, eventos, prefeituras e organizações que podem pedir contratos contínuos. O catálogo não significa que todos estão contratando agora; apenas uma parte envia propostas.
- Propostas iniciais aparecem na primeira abertura. Depois, o simulador sorteia uma quantidade variável de novas solicitações com chance moderada por dia. Ao retornar depois de dias sem abrir o app, ele simula as oportunidades do período transcorrido. Como o GitHub Pages é estático, nenhum processo roda em segundo plano com o navegador totalmente fechado; a simulação é atualizada quando o app é aberto/atualizado.
- Cada proposta mostra cliente, cidade/estado, origem e destino, data e horários, tipo de serviço, passageiros, km estimados, orçamento, custos previstos, lucro e margem. A análise é indicativa: o custo real varia conforme ônibus, trânsito, pedágios, horas de motorista, pernoite e outras condições.
- Para aceitar uma proposta, abra **Analisar proposta**, selecione **empresa, modelo, prefixo, saída da garagem e chegada prevista** e confirme a escala. O sistema alerta se a lotação solicitada excede a capacidade de referência do ônibus.
- Após aceitar um serviço pontual, o valor oferecido é lançado uma única vez como entrada no **Caixa do Grupo Conect**, identificado como `Atendimento Online` e vinculado ao código da proposta. Em contratos contínuos, o valor oferecido é mensal: a primeira mensalidade entra ao aceitar e as seguintes são registradas uma vez por mês, até o prazo solicitado pelo cliente. A agenda mostra o prazo do contrato, veículo e horários. Se já houver lançamento de caixa, o sistema reutiliza o registro para evitar duplicação.
- Três ferramentas no app: **calculadora de orçamento**, **mensagens rápidas** e **catálogo pesquisável de clientes**. A aba Agenda acompanha os fretamentos aceitos.
- Clientes, contratos e movimentos financeiros são fictícios e permanecem no armazenamento local do navegador. Esse recurso não conecta clientes reais, não aceita pagamentos verdadeiros e não garante renda real. A seleção de Pablo é somente um bloqueio visual; não é autenticação segura para um site público.


## Alterações adicionais: reserva de frota e contratos contínuos

- A exclusividade de frota é validada em ambos os sentidos: ao aceitar Atendimento Online, calcular uma escala diária e criar uma Operação de Linha recorrente. Um ônibus não pode ter duas reservas na mesma data, mesmo que os horários não coincidam; operações recorrentes também são bloqueadas quando conflitam com contratos ou escalas futuras no dia da semana escolhido.
- Contratos contínuos usam prazos específicos solicitados pelo cliente: 12, 18, 24, 30, 36, 42 ou 48 meses. A tela mostra a duração exata; a prefeitura/empresa simulada escolhe o prazo da proposta. O catálogo inclui empresas e prefeituras de várias regiões.
- Nos contratos contínuos, o valor oferecido é uma mensalidade. A primeira mensalidade entra no Caixa quando a proposta é aceita. As mensalidades posteriores são registradas em lançamentos únicos conforme cada mês vencido, quando o Atendimento Online é aberto/atualizado. Como o GitHub Pages é estático, não há execução em background enquanto o navegador está fechado.
- O mesmo ônibus de contrato contínuo fica reservado nos dias úteis do período contratado. Os fretamentos pontuais reservam o ônibus para a data específica do serviço. Ao cadastrar uma operação recorrente, se houver um serviço já confirmado para uma das ocorrências daquele dia da semana, o sistema bloqueia esse prefixo para evitar conflito; escolha outro veículo ou ajuste o dia da operação.
- Os números, clientes e contratos são simulação fictícia; a mensalidade não representa todo o valor de vários anos de uma só vez.


## Mercado 0 km (Área do Dono)

Acesse **Área do Dono → Pablo → Mercado 0 km**. O catálogo reúne famílias de carrocerias urbanas, midi, micro-ônibus, escolar, fretamento, intermunicipal, rodoviário, articulado e elétrico. Inclui famílias de modelos de Marcopolo (Torino 2027, Viaggio G8 e Paradiso G8), Caio (Apache VIP V, Millennium V e eMillennium), Mascarello, Comil, Busscar e Volare. O catálogo contém 57 famílias de carroceria e 48 opções de chassi para o configurador; a lista é filtrada por segmento e fabricante e, após escolher a carroceria, oferece somente os chassis compatíveis definidos para aquela configuração.

Na ficha, você pode escolher empresa compradora, prefixo inicial, quantidade, ano/modelo, prazo de entrega, estado de entrega, segmento, fabricante/modelo de carroceria, fabricante/modelo do chassi, motor, tipo de propulsão, posição do motor, dimensões, passageiros sentados/em pé, portas, tipo de piso, eixos, suspensão, câmbio, ar-condicionado, poltronas, acessibilidade, USB, Wi-Fi, câmeras, letreiros, GPS/telemetria, validador, pintura, interior, garantia e manutenção. Também permite gerar/copy/download uma ficha de cotação, guardar histórico, estimar compra à vista ou simular financiamento. Se registrar a aquisição e houver saldo simulado suficiente para o valor de entrada, os ônibus são adicionados à frota e os registros de financiamento/Caixa são atualizados.

**Atenção:** os preços, prazos, dimensões, lotação, motorização e compatibilidade do configurador são referências para o jogo, não uma proposta comercial nem ficha homologada de uma combinação específica. Antes de comprar de verdade, confirme a versão/modelo vigente, a compatibilidade chassi-carroceria, peso, lotação legal, equipamentos e cotação diretamente com os fabricantes. Catálogos de referência: [Marcopolo](https://onibus.marcopolo.com.br/produtos), [Caio](https://caio.com.br/), [Mascarello](https://mascarello.com.br/documentos/), [Comil](https://www2.comilonibus.com.br/produtos), [Busscar](https://busscar.com.br/produtos/), [Volkswagen Caminhões e Ônibus](https://www.volkscaminhoes.com.br/onibus/freteamento-rodoviario), [Mercedes-Benz](https://www.mercedes-benz-trucks.com.br/showroom) e [Scania](https://www.scania.com/br/pt/home/products/onibus/chassi-rodoviario.html).

## Validador de bordo — autenticação de partida simulada

O validador está disponível no menu principal e também por **Área do Dono → Pablo → Validador de bordo**. Os formulários de viagem normal, intermunicipal e serviço aceito no Atendimento Online encaminham a viagem para o validador antes da partida. O Visualizador de Operação inicia seu ciclo diretamente, sem usar o validador. O painel apresenta serviço, motorista, empresa, modelo/prefixo, cidade e linha.

Fluxo da simulação: (1) confirme que os dados da viagem estão corretos; (2) o motorista aproxima/“lê” o seu cartão funcional na área do leitor; (3) aguarde a indicação verde e a mensagem **CARTÃO ACEITO**; (4) pressione **INICIAR VIAGEM** para gravar hora, motorista, identificação simulada do cartão, empresa, ônibus, prefixo e linha; (5) a partida só prossegue depois dessa confirmação. O painel da Área do Dono permite consultar o histórico de partidas validadas. Se não houver uma viagem pendente, o validador não autoriza uma partida avulsa.

O fluxo foi inspirado em princípios públicos de bilhetagem embarcada — identificação do motorista por RFID/matrícula, controle do início de operação e registro de viagens — descritos pela [Prodata Mobility](https://prodatamobility.com.br/monte-sua-frota) e em outros sistemas de operação embarcada. A tela e os cartões do Grupo Conect são originais e simulados; não são interface oficial Prodata e não se conectam ao equipamento físico, ao cartão verdadeiro ou a qualquer sistema de bilhetagem real. O cartão é reconhecido apenas no armazenamento local desta simulação.

## Banco Grupo Conect e Agenda de Frota (novos módulos)

### Banco fictício
- Acesse Área do Dono, selecione Pablo e abra **Banco Grupo Conect**.
- O saldo inicial e atualizado é espelhado do livro-caixa original. O módulo não substitui nem apaga o Caixa existente.
- O extrato reúne arrecadação, diesel, Operação de Linha, Atendimento Online e demais entradas/saídas registradas no Caixa. Cada item possui uma visualização de comprovante simulado; o extrato pode ser exportado em CSV.
- Pix, transferência, pagamento de conta/boleto fictício, saque, depósito/aporte, cartão empresarial virtual, folha de pagamento e IPVA/DETRAN são funcionalidades de simulação local. Nenhuma transação bancária real é executada.
- A seção de ônibus financiados é uma cópia de consulta. O contrato e o pagamento das parcelas continuam no sistema de financiamento já existente.
- Para pagar salário, primeiro cadastre os motoristas nos turnos do Visualizador de Operação. Depois selecione motorista e competência, confira os valores e confirme o pagamento. O sistema impede o pagamento duplicado da mesma competência para a mesma empresa/motorista, respeita o saldo do Caixa e grava os lançamentos de salário líquido, INSS estimado, vale-alimentação, plano odontológico, FGTS estimado e contribuição patronal estimada quando marcados.
- O salário urbano do RJ (R$ 3.420,16 para motorista convencional, vale-alimentação R$ 660 e plano odontológico de referência até R$ 27,50) é uma referência de uma convenção 2025/26, com validade até 31/05/2026 — não confirmar como piso vigente para nova contratação sem verificar a convenção coletiva atual e aplicável. Os campos podem ser editados por motorista.
- O INSS é aproximado pelas faixas progressivas oficiais de 2026. O cálculo é apenas uma simulação; não é holerite, cálculo de folha legal, orientação tributária ou substituto de contador.
- No IPVA, informe valor venal e exercício de cada ônibus. A alíquota de referência no Rio de Janeiro é 2% para ônibus/micro-ônibus e 0,5% para veículos exclusivamente elétricos, sujeita à classificação legal do veículo e regras vigentes. O botão paga a próxima cota se houver saldo; cada pagamento cria movimento e comprovante simulado.

### Agenda de Frota
- Abra Área do Dono → **Agenda de Frota**. O sistema descobre os ônibus de todas as empresas cadastradas, frota-base, ônibus comprados no mercado 0 km, financiamentos, operações e contratos aceitos.
- Registre o hodômetro atual para começar as previsões. A primeira leitura define os marcos de referência para troca de óleo (10.000 km), inspeção de pneus (5.000 km) e revisão preventiva (20.000 km). São intervalos ilustrativos ajustáveis à recomendação real do fabricante e ao regime de uso do veículo.
- O calendário gera eventos de Operação de Linha e Atendimento Online, limpeza após serviço, lavagem semanal e inspeção visual mensal. Você também pode cadastrar turismo, fretamento, manutenção, óleo, pneus, documentação e outras tarefas manualmente.
- Clique num dia para ver os itens e marque cada tarefa como concluída. Tarefas de óleo, pneus, revisão e limpeza atualizam a rotina da agenda ou o registro de limpeza local.
- A faixa fixada no topo do menu principal aparece somente quando há tarefa importante/urgente de manutenção, incluindo alguns marcos por hodômetro. Use **Abrir agenda** para ir diretamente ao calendário e conferir os detalhes.

### Dados locais e backup
Os dados são guardados no `localStorage` do navegador atual; não sincronizam automaticamente entre dispositivos e não serão executados quando o navegador estiver totalmente fechado. Antes de substituir os arquivos no GitHub Pages, exporte um backup no módulo de backup existente. Os comprovantes, validador, banco, folha e agenda são documentos e transações fictícios do simulador.

## Empréstimo Empresarial — Banco Grupo Conect

- Entre em **Área do Dono → Pablo → Banco Grupo Conect → Empréstimo empresarial**.
- Informe o valor (de R$ 5.000 a R$ 10.000.000), prazo (6, 12, 18, 24, 36 ou até 48 parcelas), finalidade e garantia simulada. O painel exibe score, chance estimada de aprovação, taxa mensal, valor da prestação, juros totais e total previsto.
- A análise é simulada com base no fluxo de caixa recente, saldo disponível, contratos de empréstimo ativos, valor solicitado e garantia informada. O pedido pode ser aprovado ou recusado. Crédito acima de R$ 5 milhões sem garantia de frota ou imóvel é fortemente restringido; solicitações com fluxo de caixa insuficiente também podem ser negadas.
- Em uma campanha promocional limitada, pedidos pequenos, de prazo curto, com perfil forte e garantia podem receber taxa de 0% ao mês. Nessa situação, o total de juros fica em R$ 0,00 e a última parcela é ajustada por centavos para que o total devolvido seja exatamente o principal. Nas demais ofertas, a taxa mensal varia conforme o risco e o tamanho do crédito. A parcela usa o sistema Price, com pequeno ajuste na última parcela para arredondamentos.
- Quando aprovado, o valor integral cai imediatamente no saldo disponível por meio de uma entrada identificada como **Crédito de empréstimo empresarial (passivo)**. O crédito aumenta o caixa disponível, mas não é lucro operacional nem receita de venda. O lançamento é vinculado a um contrato único para evitar duplicação.
- No histórico, abra **Ver contrato / comprovante** para exportar/ imprimir os termos simulados. **Pagar próxima parcela** debita uma parcela do caixa se houver saldo suficiente, registra o movimento de saída e gera comprovante. O cronograma apresenta até 48 vencimentos e a situação das parcelas. As parcelas são pagas por clique no simulador, não debitadas automaticamente.
- As taxas são indicativas, não uma oferta real. O Banco Central divulga taxas por instituição, modalidade e período. Como referência, a página de capital de giro para pessoa jurídica de prazo até 365 dias mostrava taxas mensais de 1,08% a 3,92% para o período de 04/09/2026 a 11/09/2026. Fontes: [Banco Central — taxas por instituição e modalidade](https://www.bcb.gov.br/estatisticas/reporttxjuros/) e [BNDES — crédito para pequenas e médias empresas](https://www.bndes.gov.br/wps/portal/site/home/financiamento/produto/bndes-credito-pequenas-e-medias-empresas).
- O banco é fictício, usa `localStorage` deste navegador e não consulta bureaus de crédito, não faz transferência real, não empresta dinheiro verdadeiro e não sincroniza contratos automaticamente entre dispositivos.


## Correção do Visualizador de Operação — substituição e ocorrências

- Ao trocar um ônibus avariado, a linha passa para **Substituto a caminho**. O sistema registra o prefixo substituto e calcula uma previsão de chegada baseada em tráfego simulado: 22 min (livre), 25 min (moderado), 32 min (intenso) ou 40 min (muito intenso).
- A linha só retoma automaticamente quando a previsão termina. O tempo de deslocamento fica salvo no navegador; se a página for fechada e reaberta depois da chegada, a retomada é processada pelo relógio da operação.
- A conferência pré-operacional do ônibus reserva é registrada como concluída na chegada, evitando que o checklist pendente criado pela própria troca volte a colocar imediatamente a linha em parada técnica. O ônibus original permanece retido na Garagem até ser reparado.
- As decisões de ocorrência agora respeitam a resposta escolhida: desvio autorizado permite operação em desvio; orientações de aguardar/parar mantêm a linha em parada técnica; decisões de seguir rota aprovada retomam a operação.
- Ocorrências mecânicas do Visualizador bloqueiam o veículo na Garagem e criam um alerta acionável para enviar mecânico ou trocar o ônibus.
- Os tempos de tráfego são uma simulação local, não consulta a trânsito em tempo real. Todos os registros continuam no `localStorage` deste navegador.

## Central de Gestão Operacional — combustível, passageiros, jornada, fiscalização e seguro

Os módulos desta atualização foram adicionados sem substituir o Caixa, a Garagem, a Agenda, o Visualizador de Operação, o emprego ou os outros aplicativos existentes. A interface pública fica no menu principal; os controles empresariais ficam na Área do Dono.

### Área pública — Central do Passageiro
- No **menu principal**, abra **Central do Passageiro**. A página mostra as linhas registradas no Visualizador de Operação, situação operacional, ocupação estimada, reputação média e avaliações recentes.
- O passageiro pode registrar avaliação, elogio, reclamação, sugestão ou manifestação de acessibilidade. A Área do Dono recebe as manifestações em **Central de Gestão Operacional → Passageiros**; depois do atendimento, use **Marcar como atendida**.
- A demanda por viagem é uma estimativa calculada a partir do histórico disponível, capacidade configurada do ônibus, faixa de horário, fim de semana e reputação. O número de passageiros não é contagem real nem bilhetagem. Os indicadores públicos também não são um painel em tempo real conectado a GPS.
- Em hospedagem estática, o formulário só grava no navegador que recebeu a manifestação. Sem API/servidor, outro visitante em outro celular ou computador não envia a avaliação para o dispositivo do proprietário. Para atendimento público real, é necessário backend com autenticação, banco de dados e política de privacidade.

### Acesso privado na interface — Central de Gestão Operacional
- Entre em **Área do Dono**, selecione **Pablo**, abra **Central de Gestão Operacional**. As abas são **Visão geral**, **Combustível**, **Escalas**, **Passageiros**, **Fiscalização** e **Seguros**.
- A seleção de Pablo é uma restrição visual, não autenticação de servidor. Não use o site estático para armazenar informações pessoais, dados sensíveis ou contratos reais.

### Combustível e ARLA 32
- O estoque começa sem litros comprados. Na aba **Combustível**, o preço inicial do Diesel S10 é **R$ 7,99 por litro**. Selecione Diesel S10, informe os litros, confira o total e confirme a compra. O valor é debitado do Caixa e os litros são adicionados ao estoque central. O preço pode ser alterado nos parâmetros da própria tela; R$ 7,99 é o valor inicial do cenário, não uma cotação de mercado garantida.
- O ARLA 32 / AdBlue tem preço inicial de **R$ 4,99/L**, apenas como premissa editável do simulador. Compre-o separadamente quando houver ônibus configurado com SCR.
- Cada ônibus recebe uma ficha de combustível. Confira **Usa SCR / ARLA 32?**. A identificação automática procura referências a Euro V/Euro VI, SCR e ARLA no nome/configuração, mas não presume que o ano sozinho determine o pós-tratamento. Confirme manualmente com a ficha do chassi/motor real. Se marcar **Sim**, a tela passa a controlar o reservatório de ARLA; se marcar **Não**, não consome ARLA.
- Ajuste **Distância por viagem** para a distância típica daquela operação. É uma premissa em quilômetros, não um cálculo de rota por GPS. O consumo é estimado pelo km/L de referência do ônibus; o trecho precisa caber na autonomia segura do tanque.
- **Abastecimento automático antes das viagens** vem ativado por padrão. Antes da partida no Visualizador de Operação e no Validador (viagem normal, intermunicipal e fretamento aceito), o sistema estima o combustível necessário, acrescenta margem de segurança, transfere diesel do estoque central para o tanque e, para veículos SCR confirmados, transfere ARLA 32 para o reservatório. O objetivo de abastecimento é aproximadamente 72% do tanque de diesel e 70% do reservatório de ARLA, respeitando um limite operacional de 92% da capacidade; não enche até a boca.
- O estoque central precisa cobrir a quantidade mínima que falta para a viagem. Se faltar Diesel ou ARLA, a partida é bloqueada e a tela informa o motivo; comprar mais estoque ou ajustar a operação é necessário. A transferência do tanque central para o ônibus não gera uma segunda saída no Caixa: a compra já foi contabilizada. A opção **Abastecer agora** transfere estoque para completar os tanques do veículo até aproximadamente 90%.
- Ao concluir uma viagem normal, o sistema atualiza o tanque conforme a leitura final informada no fechamento. Nas outras modalidades e no Visualizador de Operação, a distância configurada alimenta a estimativa de consumo. O ARLA é aproximado como 4% do volume de diesel consumido; a taxa real depende de motor, carga, ciclo e estratégia de emissões.
- Os dados de consumo e capacidade são premissas de jogo. Consulte o manual de operação e manutenção do chassi/motor para tanque, consumo, ARLA e estratégia SCR da unidade real.

### Escalas e jornada de motoristas
- Na aba **Escalas**, escolha empresa, motorista contratado, data, linha, início, fim e intervalo. O sistema calcula horas líquidas e impede sobreposição de jornadas para o mesmo motorista. Jornadas acima de 10 horas líquidas recebem alerta para revisão; o alerta é administrativo e não substitui análise trabalhista nem convenção coletiva.
- No Visualizador de Operação, quando houver escala cadastrada para o motorista naquela data, a partida é liberada somente se o horário da operação estiver coberto. No Validador, viagens normais, intermunicipais e fretamentos também respeitam a escala cadastrada no dia, usando o horário local da tentativa de partida. Para compatibilidade com cadastros antigos, se não houver escala daquele motorista/empresa na data, o sistema não bloqueia apenas por ausência de registro.
- O sistema rejeita conflito de horário; não calcula de forma completa todas as regras legais de descanso, tempo de direção, dupla pegada, convenção coletiva, horas extras, interjornada ou regimes especiais. Cadastre escalas realistas e confira a legislação e o acordo aplicáveis.

### Demanda, capacidade e reputação
- As viagens concluídas no Visualizador de Operação alimentam um histórico estimado de demanda, ocupação e procura que não conseguiu embarcar. Os dados são gravados por operação/viagem para evitar duplicação em atualizações da página.
- A reputação começa em **80/100** como parâmetro de cenário e é recalculada com avaliações dos últimos 90 dias. A nota publicada não é uma avaliação verificada de clientes reais. O módulo não aumenta a tarifa nem gera receita automaticamente; serve como indicador e influência leve na estimativa de demanda.
- No Portal do Passageiro, o status e a ocupação são apresentados como simulados. Use a tela pública para testar o fluxo de experiência, não como informação oficial de horários, lotação ou localização.

### Fiscalização e inspeções internas
- Na aba **Fiscalização**, registre o veículo, tipo, data, resultado, itens conferidos e eventual custo/multa simulada. Freios, pneus, iluminação e saídas de emergência são itens críticos: marcar qualquer um desses itens como não conforme reprova a inspeção mesmo que o campo Resultado esteja como aprovado.
- Uma reprovação retém o ônibus e interrompe suas operações ativas no simulador. Após corrigir a pendência, registre nova inspeção aprovada para liberar o bloqueio de fiscalização. Multas simuladas são lançadas como saída no Caixa.
- O ciclo de 90 dias é um lembrete interno fictício, não a periodicidade legal de inspeção da frota. O painel não se conecta a DETRO, ANTT, Detran, Inmetro, órgãos municipais, tacógrafos ou sistemas documentais oficiais. Não confunda controle do jogo com autorização legal para circular.

### Seguros e sinistros
- Na aba **Seguros**, escolha veículo, seguradora fictícia, cobertura, valor segurado, franquia e prêmio mensal. **Registrar apólice** debita o primeiro prêmio do Caixa e cria uma vigência simulada de 12 meses. A estimativa do prêmio é parâmetro de jogo; não é cotação ou proposta de seguradora.
- Os prêmios seguintes são processados por data quando a central de gestão é aberta/renderizada. Não há cobrança em segundo plano quando o navegador está fechado. Se o Caixa não tiver saldo, a apólice fica com pagamento pendente e deixa de aparecer como ativa para novos sinistros.
- Registre o sinistro com apólice ativa, evento, valor e descrição. Depois, analise e aprove ou recuse. A indenização, quando coberta, considera a franquia e o limite do valor segurado e é lançada como entrada simulada no Caixa. A modalidade de cobertura limita os eventos elegíveis.
- Nenhuma apólice, cobertura, prêmio ou indenização é real. Não há ligação com corretora, seguradora, regulador, oficina, polícia ou sistema de pagamento.

### Persistência, limites e preservação dos sistemas anteriores
- Os dados novos usam as chaves locais `grupoConect.adminFuelStock.v1`, `grupoConect.adminFuelPrices.v1`, `grupoConect.adminFuelStates.v1`, `grupoConect.adminFuelAuto.v1`, `grupoConect.adminFuelLog.v1`, `grupoConect.adminDriverSchedules.v1`, `grupoConect.adminInspections.v1`, `grupoConect.adminInsurancePolicies.v1`, `grupoConect.adminInsuranceClaims.v1`, `grupoConect.adminPassengerFeedback.v1` e `grupoConect.adminPassengerDemand.v1`.
- O Caixa original continua sendo a fonte do saldo; as compras de combustível, multas, prêmios e indenizações entram no mesmo livro-caixa. O abastecimento central para o ônibus é somente transferência interna de litros e não duplica o custo.
- Os dados ficam no navegador/perfil atual e não sincronizam entre aparelhos. O backup JSON já existente percorre todas as chaves `grupoConect.*`, portanto inclui automaticamente os novos registros de combustível, escalas, inspeções, apólices, sinistros, avaliações e demanda. Exporte o backup antes de limpar dados do site, trocar de navegador ou substituir a instalação. Fotos no IndexedDB têm fluxo separado. Os novos módulos não criam backend, conta de usuário ou sincronização em nuvem.
- Foi preservado o conteúdo anterior do projeto. As adições são incrementais; o único ajuste auxiliar relacionado a uma falha de referência encontrada durante o teste foi corrigir o rótulo do veículo no evento pré-operacional da Agenda, para que a partida do Visualizador consiga registrar corretamente esse evento.


## Correção do Visualizador de Operação — retomada segura

Nesta revisão, o Visualizador de Operação passou a validar as condições que realmente permitem retomar uma linha antes de reativar o relógio. O botão **Retomar operação** não altera mais o status para `operando` de forma incondicional, porque a rotina de sincronização poderia interromper a linha novamente no mesmo ciclo.

Antes de liberar a linha, a rotina verifica:

- se há ônibus substituto em deslocamento;
- se o veículo continua bloqueado por pane ou ocorrência mecânica em aberto;
- se existe retenção de fiscalização ainda não regularizada;
- se a inspeção pré-operacional vinculada à viagem foi concluída e aprovada;
- se o tanque possui autonomia para a próxima partida e, quando aplicável, se há ARLA 32 suficiente.

Quando há uma pendência, o sistema mantém a operação parada e direciona o proprietário ao módulo responsável (Garagem/Mecânica, Agenda, Fiscalização ou Combustível), exibindo a causa. Quando todas as validações passam, o relógio é reativado. Um desvio autorizado anteriormente é preservado ao retomar uma operação pausada.

A recomposição do estoque de combustível também usa a mesma validação antes de reativar linhas aguardando insumos. A sincronização final limpa o marcador de falta de combustível após uma preparação bem-sucedida, evitando alertas antigos e estados inconsistentes.

Também foi corrigida uma referência inexistente chamada `gcGarageMarkAgendaDone`, utilizada ao aprovar uma ordem de serviço vinculada à Agenda. Essa chamada podia gerar `ReferenceError` no meio da aprovação, deixando a inspeção pré-operacional marcada como pendente e impedindo a retomada mesmo depois do conserto. A rotina agora conclui o evento associado, com fallback para eventos gerados automaticamente, antes de a operação voltar a passar pelas validações normais.

A revisão não removeu telas, sistemas, dados ou chaves de armazenamento existentes. As alterações funcionais estão concentradas no `script.js`; HTML e CSS foram preservados.


## Atualização do Visualizador de Operação e Agenda de Frota — manutenção sob comando do proprietário e arquivo próprio

### Manutenção: a linha só para quando o proprietário encaminha o ônibus
- Um lembrete de inspeção pré-operacional, troca de óleo, pneus, limpeza, revisão ou outra manutenção na Agenda **não interrompe sozinho** uma linha em andamento. O lembrete fica visível na Agenda; a operação continua até o proprietário decidir encaminhar o veículo à oficina.
- Para parar o veículo de propósito, abra **Agenda de Frota → Concluir tarefa → Mecânica** (ou Garagem → Conserto), selecione a garagem, o serviço e o(s) mecânico(s), e envie a ordem de serviço. **A abertura/ envio da OS é o comando explícito para parar o ônibus.** A OS também pausa todas as linhas do Visualizador que estejam usando o mesmo veículo físico (empresa + prefixo).
- Enquanto houver OS ativa — inclusive aguardando peças, em execução ou aguardando conferência — o veículo não pode iniciar outra linha/viagem. Ao aprovar a OS, o sistema procura outras ordens pendentes para o mesmo prefixo: se houver outra, mantém a parada e transfere o vínculo para ela. A linha só é liberada depois que não restar OS ativa e nenhuma outra restrição impedir a partida.
- Se a linha estava rodando antes da OS, ela volta ao estado operacional anterior (inclusive operação em desvio) após a aprovação, desde que não exista outra restrição. Se estava pausada manualmente, permanece pausada. Se a OS foi aberta para resolver uma pane mecânica vinculada à operação, a aprovação pode liberar a linha desde que a falha tenha sido efetivamente regularizada.
- Uma pane confirmada com veículo bloqueado, uma retenção reprovada pela fiscalização, uma substituição ainda em deslocamento e a falta de Diesel/ARLA necessário continuam sendo bloqueios operacionais de segurança. Isso é diferente de uma manutenção preventiva apenas recomendada: não se deve liberar um ônibus com uma pane ou retenção ativa.
- Abertura de uma OS agora guarda o estado anterior da linha. Também há tratamento de compatibilidade para linhas antigas que tenham ficado em **parada técnica** apenas por um lembrete de inspeção de versões anteriores; ao encaminhá-las à oficina e aprovar o serviço, o sistema pode restabelecer o funcionamento. Mais de uma OS simultânea para o mesmo ônibus não libera a linha prematuramente.

### Arquivo independente do Visualizador — salvar e restaurar
- No **Visualizador de Operação**, abaixo da lista de linhas, use **Salvar todas as informações do Visualizador**. O navegador baixa um JSON independente do backup geral do site. Guarde esse arquivo fora do navegador (computador, pasta de documentos ou armazenamento pessoal).
- O arquivo contém as linhas cadastradas e seus parâmetros, estado e relógio, viagens concluídas do Visualizador, últimos registros de viagem, totais por motorista, ocorrências e decisões, dados internos de contabilização de lucro para evitar lançamento duplicado no Caixa, contagem de motoristas virtuais e o histórico de viagens normais que alimenta as médias dos Dias 1, 2, 3, 4, 5 e dias seguintes.
- Para recuperar linhas removidas, abra **Restaurar informações salvas**, selecione o JSON anteriormente baixado e aguarde a mensagem de conclusão. A restauração **mescla** o arquivo com os dados atuais; não limpa o site nem apaga módulos. Ela concilia a parcela do resultado líquido das operações no Caixa para evitar duplicidade, mas preserva os lançamentos manuais do Caixa e os registros dos demais sistemas. Linhas são conciliadas por ID ou por empresa/cidade/linha/prefixo/dia/horário para evitar duplicação comum. Históricos normais são mesclados pelo ID da viagem.
- Faça o arquivo antes de remover linhas. Se recriar uma linha antes de restaurar, confira os registros conciliados e o número de viagens para não misturar uma operação antiga com uma linha nova que tenha o mesmo percurso, veículo e horário. A restauração prioriza o registro com mais viagens concluídas e combina os logs disponíveis; em caso de divergência de cadastros, revise a ficha manualmente.
- A restauração valida o arquivo antes de gravar e mantém uma cópia temporária das chaves envolvidas; se uma das gravações falhar, tenta reverter o conjunto para evitar dados pela metade. O arquivo é local e não é enviado para nuvem. Ele não substitui o backup geral do site; é específico do Visualizador e do histórico normal necessário para a análise de tarifa. Fotos e os demais dados de outros aplicativos não fazem parte desse JSON.

### Médias do histórico normal — Dias 1, 2, 3, 4, 5 e seguintes
- Ao cadastrar uma nova linha no Visualizador, o sistema pesquisa todas as viagens normais guardadas no histórico, sem limitar ao dia atualmente selecionado. Portanto, viagens dos Dias 1 a 5 e dos dias adicionais entram na amostra se tiverem **empresa, cidade e nome da linha** compatíveis.
- A comparação ignora diferenças de maiúsculas/minúsculas, acentos e pontuação, mas não mistura empresas, cidades ou linhas diferentes. Por exemplo, `Nova Suíça` e `nova suica` são compatíveis; uma linha de outra empresa não entra na média.
- Quando encontra histórico, a simulação calcula médias de arrecadação, custo de Diesel e resultado líquido por percurso. Sem amostra compatível, usa os valores manuais informados no cadastro e identifica essa base na tela.
- As viagens normais precisam ter sido finalizadas e salvas. Registros antigos sem cidade ou linha devem ser completados em **Histórico de viagens → Identificar cidade/linha para análise**. O cálculo não usa apenas o dia selecionado.
- A operação salva sua base econômica no momento em que é cadastrada. Novas viagens normais posteriores não reescrevem retroativamente os valores dos percursos já registrados no Visualizador; para usar a nova média, cadastre uma nova operação/linha ou refaça o cadastro depois de salvar o arquivo do Visualizador e conferir o histórico.

### Desempenho em celulares
- O Visualizador continua sincronizando o relógio, processando viagens e contabilizando o Caixa em ciclos de 1 segundo. Para reduzir travamentos visuais em celulares, a reconstrução completa dos cartões foi limitada a no máximo uma vez a cada 2,5 segundos enquanto houver linha ativa. Mudanças de estado (por exemplo, uma linha que para por combustível, pane ou OS) também provocam atualização da interface, mesmo que não reste outra linha em andamento. A tela não força reconstruções periódicas enquanto está em segundo plano.
- Essa otimização é localizada no Visualizador; não removeu recursos nem alterou os demais sistemas. Ela diminui reconstruções completas do painel em aproximadamente 60% durante operação contínua, mantendo a lógica de sincronização de 1 segundo.
- Outras otimizações que podem reduzir o peso no celular sem remover funcionalidades: renderização sob demanda de listas longas (Mercado de Peças, candidatos, histórico e relatórios), paginação/virtualização de listas extensas, adiar a montagem dos painéis até serem abertos, debounce nas buscas, reduzir sombras/transições pesadas em telas pequenas, comprimir imagens e minificar CSS/JavaScript na publicação. Essas otimizações adicionais não foram aplicadas nesta atualização para manter o escopo restrito ao Visualizador e à Agenda.

### Validação desta atualização
- JavaScript verificado com `node --check`.
- IDs do HTML conferidos sem duplicações; link de `style.css` e `script.js` verificado.
- CSS analisado com parser; nenhum erro de parsing encontrado.
- Regressões lógicas verificadas para: pausa explícita pela OS, liberação condicionada a outras OS, pausa manual preservada, lembrete preventivo sem interrupção, merge do arquivo e médias históricas dos Dias 1 a 5.
- Não foi possível concluir navegação e cliques em navegador real nesta sessão por bloqueio do ambiente local de navegador. Os testes automatizados e estruturais não substituem validação final no Chrome/Edge do dispositivo em que o site é usado.


## Atualização — troca programada de veículo e prazo automático das ocorrências

### Trocar veículo da operação
1. Abra **Área do Dono → Visualizador de Operação**.
2. Na linha desejada, pressione **Trocar veículo da operação**.
3. Selecione a empresa proprietária do veículo reserva e, em seguida, o prefixo/modelo disponível.
4. Pressione **Enviar ônibus ao terminal e programar troca**.
5. O sistema calcula o trânsito simulado (22, 25, 32 ou 40 minutos) e encaminha o reserva ao terminal de encontro. Se o ônibus atual estiver no meio do percurso, ele conclui esse percurso até o terminal correspondente. Se o reserva chegar primeiro, fica aguardando; se o ônibus da linha chegar primeiro, a operação aguarda no terminal. A troca de prefixo/empresa só ocorre no encontro dos dois veículos.
6. Após o encontro, o reserva passa a ser o veículo da operação. O histórico de viagens anteriores mantém o prefixo e a empresa do ônibus que efetivamente realizou cada percurso; abastecimento, desgaste e registros seguintes passam a usar o novo ônibus.

A lista só oferece ônibus livres, sem pane, sem ordem de serviço ativa e com condição mecânica estimada de pelo menos 45%. A disponibilidade é validada novamente na hora da troca. Uma linha pausada no meio do trajeto precisa ser retomada para alcançar o terminal; uma linha pausada no terminal pode aguardar o reserva. Panes mecânicas devem continuar sendo tratadas pelo alerta da Garagem, não pelo botão de troca programada.

### Duração simulada das ocorrências
Os prazos não são tempos universais de trânsito real. São parâmetros de simulação por decisão, em minutos simulados. O multiplicador de velocidade da operação converte esses prazos para tempo real; por exemplo, 30 minutos simulados com velocidade 10 equivalem a 3 minutos de relógio.

| Tipo de ocorrência | Decisão (ordem exibida na lista) | Prazo simulado |
|---|---|---:|
| Acidente | Parar em local seguro e comunicar a central | 20 min |
| Acidente | Proteger passageiros e aguardar autoridades/central | 45 min |
| Acidente | Usar desvio oficial autorizado | 30 min |
| Acidente | Registrar ponto/horário e aguardar liberação | 60 min |
| Acidente | Acionar emergência e não avançar na área insegura | 90 min |
| Obra | Seguir sinalização e desvio autorizado | 40 min |
| Obra | Reduzir velocidade e respeitar sinalização | 15 min |
| Obra | Parar e pedir orientação se não houver desvio claro | 20 min |
| Obra | Registrar atraso e atualizar previsão | 10 min |
| Obra | Retomar itinerário original quando liberado | 15 min |
| Mecânica | Encostar, sinalizar e comunicar manutenção | apoio estimado: 25 min reais |
| Mecânica | Solicitar equipe de apoio | apoio estimado: 45 min reais |
| Mecânica | Solicitar veículo reserva | acionamento estimado: 25 min reais |
| Mecânica | Registrar pane e sintomas | avaliação inicial: 20 min reais |
| Mecânica | Manter parada até avaliação/liberação | avaliação estimada: 60 min reais |
| Trânsito | Manter rota aprovada e informar atraso | 20 min |
| Trânsito | Solicitar desvio previamente autorizado | 30 min |
| Trânsito | Aguardar se não houver rota segura | 15 min |
| Trânsito | Atualizar previsão de chegada | 10 min |
| Trânsito | Reprogramar partidas seguintes | 25 min |
| Clima | Não entrar em trecho alagado e pedir orientação | 45 min |
| Clima | Aguardar avaliação/liberação oficial | 60 min |
| Clima | Informar central e registrar ponto afetado | 15 min |
| Clima | Usar alternativa previamente aprovada | 35 min |
| Clima | Retomar quando a via estiver liberada | 30 min |

Acidentes, obras, trânsito e clima encerram automaticamente ao fim do prazo e retornam ao itinerário normal, desde que não exista outro bloqueio independente. Um desvio não fica ativo indefinidamente. Um evento mecânico **nunca libera o ônibus automaticamente**: o prazo indica chegada/avaliação de apoio, mas a linha permanece bloqueada até reparo aprovado ou substituição. A opção **Manter linha parada** é uma decisão manual e exige retomada posterior pelo proprietário.

Ocorrências antigas que ficaram em **Operando com desvio** são migradas usando a decisão registrada e seu prazo previsto; se o prazo já passou, a rota normal é retomada na próxima sincronização. O histórico da ocorrência permanece no registro.

### Validação desta atualização
- Verificação sintática de JavaScript (`node --check`).
- Conferência da integridade da estrutura do projeto e dos IDs HTML.
- Fluxos revisados por código: escolha de empresa/ônibus, verificação de disponibilidade, envio ao terminal, ônibus atual concluindo percurso, reserva aguardando, troca no encontro, associação cruzada de veículo/empresa, contabilização de combustível e desgaste por ônibus efetivamente utilizado, temporização de incidentes e migração de desvios antigos.
- A execução de navegação automatizada em navegador foi tentada, mas a política do ambiente bloqueou o acesso local ao site; portanto, a validação final de cliques deve ser feita no navegador do usuário.

### Regras adicionais de pausa e migração
- Se a linha já estava pausada manualmente antes de uma ocorrência, registrar um desvio ou uma ocorrência temporizada não remove essa pausa. Ao terminar o prazo, a linha continua pausada até você usar **Retomar operação**.
- A mesma preservação é aplicada quando uma pane mecânica é reparada: a aprovação da OS não desfaz uma pausa manual anterior.
- Ocorrências ativas de versões anteriores que não tinham `endsAtMs` recebem um prazo de migração conforme o tipo e a decisão registrada. Em ocorrência mecânica, o prazo indica a chegada/avaliação do apoio e não libera o ônibus.

### Testes adicionais executados
- Chromium headless carregou a estrutura completa do site incorporada em uma página de teste; nenhum erro JavaScript foi observado nos fluxos exercitados.
- Troca testada nas duas ordens possíveis: reserva chega antes do ônibus atual e aguarda; ônibus atual chega primeiro e aguarda o reserva. Em ambos os casos, a identificação só muda após o encontro no terminal.
- Testada a mudança entre empresas, preservação do prefixo antigo no histórico e associação do novo veículo para as próximas viagens.
- Testada uma decisão de desvio de trânsito (30 minutos simulados com velocidade 10), o encerramento automático do desvio e a retomada do itinerário normal.
- Testadas a migração de desvios antigos e de incidentes ativos sem prazo, além da preservação da pausa manual.
- Testada ocorrência mecânica: a equipe de apoio chega ao fim do prazo, mas o ônibus continua fora de operação e bloqueado até reparo aprovado ou substituição.
- Os testes de interação usaram armazenamento local simulado na página de teste; não substituem a verificação final com os dados reais no navegador/dispositivo do usuário.

---

## Jovem Aprendiz Virtual e Funções Dono (atualização de 04/11/2026)

### Acesso ao Jovem Aprendiz
1. No menu principal, abra **Área do Dono**.
2. Selecione **Pablo** e entre na área privada.
3. Abra o cartão **Jovem Aprendiz Virtual**.
4. Clique em **Analisar sistemas agora** para fazer uma varredura. Enquanto o proprietário continuar selecionado e a página estiver visível, o scanner também verifica novamente em intervalos aproximados de 30 segundos.
5. Confira cada apontamento. **Autorizar ação** abre uma confirmação explicando o que será feito; **Recusar** encerra a sugestão sem alterar o módulo original.

O Jovem Aprendiz, chamado Caio, é um assistente fictício baseado em regras locais do site. Não é uma IA conectada, não consulta sistemas externos e não substitui uma inspeção física. A análise é de leitura: não corrige nem paga nada sozinha.

### O que o Aprendiz identifica e o que acontece após a autorização
- **Limpeza/lavagem pendente na Agenda:** depois de sua confirmação, marca a tarefa existente como concluída no módulo Agenda e gera o apontamento de limpeza correspondente. A confirmação digital não comprova que a lavagem física foi feita; confira o ônibus.
- **Manutenção, óleo ou pneus pendentes:** depois de sua confirmação, abre o encaminhamento para a Garagem. Você ainda escolhe garagem, serviço e mecânico e confirma a ordem de serviço no módulo original. O Aprendiz não cria nem aprova a OS sozinho.
- **Condição crítica na ficha da Garagem:** abre a ficha/conserto para você conferir e decidir.
- **Ficha técnica incompleta:** aponta ônibus cujo ano ou hodômetro ainda é estimado e abre a Garagem para revisão. Não inventa nem grava valores.
- **Folha do mês ainda não registrada:** abre a folha para o funcionário selecionado. Antes de pagar, há uma segunda confirmação financeira; o sistema verifica salário, competência duplicada, cartão empresarial e saldo disponível. O pagamento continua sendo processado pelo Banco original e lançado no Caixa simulado.
- **Linha sem motorista identificado:** direciona ao Visualizador de Operação para você revisar a escala; não inventa motorista.

Se uma pendência deixa de aparecer em uma análise posterior, a sugestão antiga passa a **Resolvido em outro módulo**. Isso evita manter pedidos pendentes depois de uma correção feita diretamente na Agenda, Garagem ou Banco. Uma sugestão recusada não é reaberta automaticamente na mesma data.

### Três ferramentas extras do Aprendiz
- **Auditoria de Frota:** relatório de prefixos repetidos, condição crítica, fichas estimadas e ordens de serviço em andamento.
- **Conferência de Salários:** visão de funcionários contratados, competência atual e folhas já registradas.
- **Relatório Diário:** resumo de tarefas de Agenda, ordens ativas, veículos bloqueados e frota reconhecida.

Essas três ferramentas são consultas. Apenas abri-las não altera veículos, agenda, ordens ou folha.

### Funções Dono — quinze atividades recorrentes
No menu principal, abra **Funções Dono**. Para registrar decisões, pontos, histórico ou acessar dados privados da frota, selecione primeiro **Pablo** na Área do Dono.

1. **Fretamento Extra:** gere até cinco propostas fictícias por dia; avalie receita e custos; aceite e conclua um serviço. O botão final pede confirmação e lança somente o lucro líquido estimado no Caixa local, com identificador para evitar crédito duplicado. Não altera o estoque físico de diesel/ARLA e não representa recebimento real ou contrato verdadeiro.
2. **Desafio de Despacho:** gere cenários repetidos de trânsito, lotação, fadiga e falha pré-viagem e escolha uma decisão.
3. **Planejador de Escala:** teste demanda, capacidade dos veículos, quantidade de ônibus e intervalos.
4. **Negociação com Fornecedores:** gere três cotações simuladas e compare desconto, prazo e confiabilidade. A escolha fica como referência; não altera o preço real do módulo de combustível.
5. **Atendimento VIP:** receba casos fictícios de atendimento e acompanhe a satisfação simulada.
6. **Marketing de Linhas:** compare campanhas e retorno projetado. Não debita orçamento real do Caixa.
7. **Leilão de Contratos:** receba pedidos fictícios, informe preço e avalie margem e probabilidade estimada de conquistar o serviço.
8. **Raio-X da Frota:** consulte indicadores locais e abra a Garagem para conferência.
9. **Avaliação de Usados:** avalie ofertas fictícias considerando preço, preparação e referência de mercado. Não compra nem debita dinheiro.
10. **Quiz do Gestor:** responda perguntas sorteadas de operação, segurança, manutenção e gestão.
11. **Quebra-cabeça do Terminal:** distribua ônibus em plataformas conforme acessibilidade, altura, permanência e horários de chegada; cada rodada muda.
12. **Diagnóstico Express:** escolha a primeira conduta segura para sintomas simulados de motor, freio, pneus, ar pneumático e SCR/ARLA 32. Não substitui diagnóstico de oficina.
13. **Planejador de Rota e Clima:** escolha estratégias para ocorrências de clima, congestionamento e restrições viárias, equilibrando segurança, tempo e comunicação.
14. **Contrato Escolar Extra:** gere solicitações escolares fictícias, monte tarifa por aluno/dia e dispute contratos. Ao concluir um contrato com margem líquida positiva, confirme o crédito simulado no Caixa. Limite de quatro propostas por dia.
15. **Publicidade na Frota:** negocie campanhas fictícias, dimensione quantidade de veículos/duração e proponha o preço. Ao concluir uma campanha com margem positiva, confirme o crédito simulado no Caixa. Limite de cinco propostas por dia.

Os desafios, cotações, propostas e contratos são simulações para entretenimento/treino de gestão; não são reservas, contratos comerciais, movimentos bancários reais nem integração com OMSI 2. Três atividades podem creditar resultado líquido simulado no Caixa: Fretamento Extra, Contrato Escolar Extra e Publicidade na Frota. Os dois simuladores novos de contrato escolar e publicidade exigem conclusão e confirmação explícita, usam identificadores únicos para impedir crédito duplicado e não alteram combustível, frota ou viagens reais. O histórico e a pontuação ficam no armazenamento local do navegador.

### Armazenamento e limites
- As novas informações usam as chaves locais `grupoConect.apprenticeAssistant.v1` e `grupoConect.ownerActivities.v1`.
- Os dados ficam no navegador e perfil em que foram criados. Não há sincronização automática entre celular e computador nem servidor externo.
- O seletor de proprietário e as confirmações são uma trava de fluxo dentro do simulador, não um sistema de autenticação de segurança para publicação aberta na internet.
- A estimativa de fretamento calcula margem simulada incluindo combustível, pedágio, motorista e taxa operacional; o estoque de combustível não é consumido por essa atividade. Essa separação é intencional para não duplicar lançamentos no módulo de abastecimento.
- O scanner não confirma se a lavagem ocorreu, não diagnostica defeitos por telemetria e não substitui o responsável pela oficina ou o contador.

### Validações desta atualização
- JavaScript verificado com `node --check`.
- HTML: 1.146 IDs, todos únicos.
- CSS analisado com parser: 1.389 nós de regra/at-rule, nenhum erro estrutural de parsing.
- Chromium headless: autorização em lote cancelada sem alterar status; dois itens autorizados e dois recusados em lote; Quebra-cabeça do Terminal, Diagnóstico Express e Planejador de Rota executados; Contrato Escolar Extra e Publicidade na Frota concluídos, cada um com um único crédito no Caixa. Sem exceções JavaScript nos fluxos exercitados. Sem overflow horizontal nas viewports de 320 × 780, 390 × 844 e 1.365 × 900.
- Ferramentas Auditoria de Frota, Conferência de Salários e Relatório Diário abertas e verificadas como consultas sem gravação local apenas por visualização.
- Chromium headless em viewport desktop 1365 × 900: sem rolagem horizontal detectada.
- Estes testes usaram armazenamento de teste isolado. A validação final com seus dados reais deve ser feita no navegador habitual, preservando o perfil local e mantendo um backup geral antes de substituir arquivos.

---

## Atualização — Monitoramento de ocorrências pelo Jovem Aprendiz

O Caio agora verifica o Visualizador de Operação periodicamente enquanto a página está aberta/visível e Pablo está selecionado. A leitura ocorre a cada 30 segundos e também quando a aba volta a ficar visível. O monitor é local ao navegador: ele não funciona com o site fechado, sem conexão ou em outro aparelho que não esteja aberto.

### Pane mecânica e recomendação de reserva

Quando existe uma pane mecânica aberta vinculada a uma operação, o Aprendiz:

1. Lê a ocorrência, o prefixo, a empresa, a linha e o componente que gerou o alerta.
2. Pesquisa os ônibus cadastrados que não estão alocados em outra operação, nem reservados para outra troca, sem pane ou ordem de serviço ativa e com condição mecânica estimada de pelo menos 45%.
3. Exige a mesma família operacional do veículo avariado (por exemplo, micro-ônibus, urbano ou rodoviário) para evitar substituição incompatível; entre os compatíveis, prioriza a mesma empresa, depois condição e proximidade de modelo.
4. Apresenta a recomendação para Pablo. Nenhuma troca é executada sem autorização explícita.
5. Após a autorização, utiliza o procedimento original de despacho mecânico da Garagem. O Visualizador registra `replacementDispatch`, preserva o temporizador de deslocamento e mantém a linha bloqueada até a chegada do reserva. O prazo simulado segue a regra já existente de trânsito (22, 25, 32 ou 40 minutos).

Se não houver reserva apto, o Aprendiz recomenda manter o ônibus parado, registra orientação segura ao motorista e abre a área de alertas da Garagem para você escalar o mecânico. Ele não cria uma ordem de serviço nem compra peças automaticamente.

### Incidentes de trânsito, obra, acidente e clima

Para ocorrências não mecânicas ativas, Caio prepara instruções ao motorista. Com sua autorização, registra a orientação no histórico da linha sem alterar o status, o desvio ou os temporizadores da ocorrência existente.

### Relatórios

A área do Jovem Aprendiz ganhou a seção **Relatórios de ocorrências e respostas**. Cada relatório registra o problema, operação/veículo, análise de disponibilidade, recomendação, ação autorizada, instrução ao motorista, previsão de chegada e peça provável a conferir. É possível baixar cada relatório em TXT.

A peça indicada é uma hipótese baseada no componente que gerou o alerta. O preço-base exibido é referência fictícia do catálogo interno, não cotação de fornecedor. Quantidade, referência compatível e necessidade de compra devem ser confirmadas pelo mecânico após diagnóstico. Não há compra automática.

### Autorização e segurança

Toda ação do Aprendiz continua exigindo confirmação de Pablo. A análise pode ser automática; despacho, registro de orientação ou encaminhamento só ocorre após autorização. O ônibus avariado não é liberado por enviar o substituto: permanece bloqueado na Garagem para reparo. O timer de substituição existente não foi removido nem substituído.


## Atualização — multi-seleção do Jovem Aprendiz e 5 simuladores

### Jovem Aprendiz: autorização em lote
- Marque a caixa de cada recomendação pendente ou use **Selecionar todos os pendentes exibidos**.
- Use **Autorizar selecionados** ou **Recusar selecionados**.
- O sistema pede uma confirmação geral antes de executar/recusar o lote.
- Ações financeiras, como folha salarial, continuam exigindo confirmação financeira individual, além da autorização geral.
- Itens que falharem na execução permanecem pendentes para nova análise; não são marcados como concluídos por engano.
- A seleção é temporária na tela; decisões e histórico continuam salvos no armazenamento local existente.

### Funções Dono: cinco simuladores novos
11. **Quebra-cabeça do Terminal:** aloque três ônibus em plataformas, evitando sobreposição e respeitando requisitos de acessibilidade e altura.
12. **Diagnóstico Express:** escolha a primeira conduta segura diante de sintomas mecânicos simulados. É exercício educativo, não diagnóstico de veículo real.
13. **Planejador de Rota e Clima:** compare alternativas e tome decisões de segurança, tempo e comunicação.
14. **Contrato Escolar Extra:** gere solicitações fictícias, faça uma proposta por aluno/dia e conclua o mês simulado para creditar lucro líquido no Caixa.
15. **Publicidade na Frota:** negocie campanhas fictícias, defina um preço e conclua a campanha simulada para creditar lucro líquido no Caixa.

Os dois simuladores financeiros usam IDs únicos no razão do Caixa para evitar crédito duplicado. Exigem confirmação explícita antes de creditar. Receitas, custos, contratos e lucros são simulados; não alteram estoque físico de combustível, frota, adesivagem real ou viagens do Visualizador. Os simuladores têm limites diários de quatro contratos escolares e cinco propostas publicitárias, com histórico persistido no mesmo armazenamento local de Funções Dono.


### Correções e verificações adicionais da atualização de multi-seleção
- Corrigido um erro no caminho de recusa: a função buscava o item no objeto principal em vez de procurar dentro da lista `findings`; isso impedia recusa individual e em lote.
- A recusa agora só é contabilizada quando a gravação do status no armazenamento local é confirmada.
- O indicador **Lucro extra no Caixa** soma resultados concluídos de Fretamento Extra, Contrato Escolar Extra e Publicidade na Frota.
- Menu e texto da página atualizados de dez para quinze atividades.
- Testado em Chromium headless: selecionar itens individuais, cancelar a confirmação sem modificar status, autorizar dois itens em lote e recusar dois outros em lote; três simuladores de desafio; geração e conclusão de contrato escolar e campanha de publicidade com um registro de Caixa para cada operação; viewport móvel sem overflow horizontal e sem exceções JavaScript nos fluxos exercitados.


## Correção do Visualizador de Operação — despacho, incidentes e turnos

Esta atualização é aditiva e preserva os demais módulos.

### Substituição após pane
- Ao despachar um ônibus reserva, o cartão da linha apresenta um contador visível de chegada e o status **SUBSTITUTO A CAMINHO**.
- O horário de chegada é persistido em milissegundos e também como data ISO. Se uma versão antiga tiver somente um dos formatos, a rotina normaliza os dados antes de calcular o timer.
- O relógio da linha permanece congelado durante o deslocamento. Quando o prazo termina, o sistema valida novamente a disponibilidade do veículo, encerra o despacho e retoma a operação.
- Se o reserva receber uma pane, retenção ou OS durante o trajeto, não é liberado: o sistema cancela o despacho, reabre o alerta do ônibus avariado e mantém a linha parada para uma nova decisão.
- O histórico de viagens, lucros e viagens concluídas não é apagado pela troca.

### Ocorrências e retorno do desvio
- Desvios temporários voltam ao itinerário normal ao vencer o prazo da decisão.
- Registros antigos sem contador são migrados usando a decisão e a data já registradas.
- Um desvio vencido não permanece exibido como ativo quando existir outro bloqueio: pane, ordem de serviço, fiscalização ou falta de combustível/ARLA. Nesse caso a linha passa ao status de parada correspondente, sem liberar o ônibus.
- Ocorrências mecânicas continuam exigindo liberação da oficina; o temporizador da equipe de apoio não libera o veículo por conta própria.
- Pausas manuais são preservadas.

### Turnos do Visualizador
A atribuição do motorista usa o horário de início de cada viagem: manhã **05:00–11:59**, tarde **12:00–17:59** e noite **18:00–04:59**. A operação não atribui silenciosamente o motorista da manhã a outro turno caso o campo correspondente esteja vazio; nesse caso o histórico identifica **Motorista não definido**.

### Testes desta atualização
Foram exercitados em Chromium headless os fluxos de despacho e contador, conclusão por chegada, reserva indisponível na chegada, normalização de desvio vencido com e sem bloqueio independente, recuperação de registros legados, preservação de pane/ordem de serviço, pausa manual e limites dos três turnos. A verificação de sintaxe JavaScript, IDs HTML, parsing CSS e integridade do ZIP também foi executada. Consulte a resposta de entrega para os resultados quantitativos e as limitações do ambiente.

## Revisão adicional — timer de substituição, encerramento de desvios e turnos

Esta revisão mantém todos os módulos e os IDs HTML existentes. A camada de correção é aditiva e atua sobre o fluxo já utilizado pelo Visualizador de Operação.

### Despacho de ônibus substituto
- Ao confirmar **Trocar ônibus** em uma pane, a operação passa para **SUBSTITUTO A CAMINHO** e apresenta a contagem regressiva no cartão e no aviso de despacho.
- A previsão é persistida como timestamp (milissegundos e ISO) para sobreviver a atualização/reabertura da página.
- O tempo estimado permanece o já configurado para o trânsito: livre 22 min, moderado 25 min, intenso 32 min e muito intenso 40 min.
- O relógio e os registros de viagens ficam preservados durante o deslocamento. O timer não depende de o cartão estar aberto para ser processado: a sincronização do Visualizador é executada em segundo plano e também é atualizada ao retornar à aba.
- Na chegada, a disponibilidade do substituto é conferida novamente. Se continuar livre e apto, o despacho é finalizado e a linha retoma; se tiver recebido pane, OS ou outra alocação, a troca falha com segurança, o alerta do veículo avariado é reaberto e a linha continua parada.

### Encerramento automático de desvios
- Cada decisão continua usando sua duração simulada específica e o multiplicador de velocidade configurado na linha.
- Ao vencer o prazo, o incidente é encerrado e o itinerário normal é restaurado automaticamente.
- A rotina também recupera registros antigos que ficaram em **operando com desvio** sem objeto de temporizador, usando a data e a decisão registradas no histórico.
- Se o prazo terminar enquanto houver pane, ordem de serviço, retenção de fiscalização ou falta de diesel/ARLA 32, o desvio é encerrado, mas a linha não é liberada indevidamente: permanece no estado de bloqueio correspondente.
- Uma pausa manual permanece pausada. Ocorrências mecânicas continuam exigindo liberação manual da oficina.

### Turnos e partidas
- Turno da manhã: 05:00–11:59.
- Turno da tarde: 12:00–17:59.
- Turno da noite: 18:00–04:59.
- A atribuição é feita pelo horário simulado de início de cada viagem, não apenas pelo horário de cadastro da linha. Se o motorista daquele turno estiver vazio, o histórico mostra **Motorista não definido**, sem atribuir incorretamente o motorista da manhã.
- O ciclo de operação mantém a regra das partidas entre 05:00 e 23:00; quando o percurso ultrapassa 23:00, a próxima partida aguarda 05:00 do dia seguinte.

### Validações executadas nesta revisão
- Despacho real da ocorrência com exibição do timer; a chegada foi acelerada em ambiente isolado para testar o ciclo completo sem aguardar os 22–40 minutos reais.
- Timer continuando e sincronizando quando a interface do Visualizador não está em primeiro plano; ao abrir novamente a Área do Dono, o cartão é renderizado com o estado final correto.
- Reabertura do alerta original quando o reserva se torna indisponível durante o trajeto.
- Encerramento ao vivo de um desvio vencido e retorno ao status **operando**.
- Preservação de pausa manual e de bloqueios mecânicos independentes.
- As 25 combinações de cinco tipos de ocorrência por cinco decisões: duração selecionada e classificação manual/mecânica conferidas.
- Uma viagem efetivamente concluída em cada turno, com motorista, turno e resultado atribuídos corretamente.
- Pausar e retomar: status e relógio preservados.
- Ciclo noturno: percurso que termina depois de 23:00 agenda a próxima partida para 05:00.
- Layout do Visualizador verificado em 320, 390, 768 e 1365 px, sem rolagem horizontal nos cenários testados.
- JavaScript passou em `node --check`; 1.146 IDs HTML únicos, sem duplicações ou remoções em relação à versão-base; 1.389 regras/blocos CSS analisados sem erros de parsing; ZIP verificado.

Os testes de duração foram acelerados no navegador automatizado para validar a transição de estado; os prazos reais de substituição continuam sendo 22–40 minutos conforme o trânsito simulado. O sistema permanece uma simulação local, não GPS ou tráfego em tempo real.


## Atualização de 07/11/2026 — Oficina, retomada com reserva e Jovem Aprendiz

### Aprovação de ordens de serviço
- A aprovação agora reconcilia o ônibus por empresa + prefixo, além do identificador interno da OS.
- Alertas mecânicos compatíveis com o serviço aprovado são baixados com registro de resolução.
- A operação é liberada após a conferência se não houver outra OS, pane, retenção, falta de combustível ou fiscalização pendente.
- Pausas manuais anteriores permanecem pausadas.

### Retomar operação com ônibus reserva
- Ao clicar em Retomar numa linha parada por pane, OS aberta ou bloqueio de abastecimento, é exibido um seletor por empresa e veículo livre.
- O reserva precisa estar sem vínculo operacional, sem alerta/OS ativa e com condição estimada mínima de 45%.
- Diesel/ARLA são preparados antes do despacho, quando o módulo de combustível está disponível.
- A linha passa para “substituição em deslocamento”; o contador persistente usa 22, 25, 32 ou 40 minutos conforme o trânsito simulado.
- A ocorrência mecânica permanece associada ao ônibus antigo para que ele possa ser reparado separadamente.
- Ao chegar, o Visualizador conclui o despacho pela rotina original e retoma a operação; a pausa manual e bloqueios de segurança não são ignorados.

### Jovem Aprendiz — escala de mecânico
- Caio cruza componente com serviço de oficina, especialidade, nível e disponibilidade dos mecânicos.
- Após autorização explícita, abre uma ordem de serviço com o mecânico mais compatível; em panes classificadas como urgentes, seleciona dois profissionais diferentes quando disponíveis.
- A OS reutiliza a rotina original de oficina, lista as peças, aguarda entrega quando necessário e mantém custo/relatório no sistema existente.
- O Aprendiz não compra peças nem libera o ônibus por conta própria.

Nota: recomendações, preços, condições, disponibilidade e trânsito continuam sendo simulações locais. O sistema não substitui diagnóstico mecânico presencial, catálogo de peças ou validação de segurança do veículo.

## Atualização de 07/11/2026 — liberação de OS, retomada com reserva e escala mecânica pelo Jovem Aprendiz

### Correção da conferência de ordens de serviço
- Antes da conferência, o registro da OS é reconciliado com o ônibus cadastrado na frota, usando prefixo, empresa e modelo para normalizar chaves antigas que possam ter sido gravadas com variação no nome da empresa.
- A ficha técnica é recuperada/criada sob a chave canônica do veículo antes da rotina original de aprovação, evitando que uma OS antiga fique sem correspondência com o estado mecânico atual.
- Após a aprovação, alertas vinculados ao mesmo ônibus são revisados. Uma pane com componente identificado só é baixada quando o serviço/peça cobre aquele componente e a condição registrada atingiu pelo menos 40%. Alertas antigos sem componente podem ser encerrados na conferência. Limpeza isolada não encerra pane mecânica.
- A linha só é retomada quando a OS foi aprovada, não há outra ordem ativa, alerta mecânico aberto ou retenção independente, e as verificações de pré-partida/combustível permitem a partida.
- A correlação da OS com a operação considera identificador de alerta, vínculo de OS, prefixo e variações compatíveis do nome da empresa. Se o veículo já foi substituído e a linha está com outro ônibus, aprovar a OS antiga não remove a substituição em andamento nem coloca o veículo reparado de volta no meio do percurso.
- Uma pausa manual anterior continua pausada. Uma segunda OS, pane não coberta ou fiscalização ainda pendente mantém o veículo/linha retidos.

### Retomar operação com veículo livre
- Ao clicar em **Retomar operação** numa linha em **fora de operação** ou **parada técnica** (por pane, OS, falha ou outro bloqueio do veículo), o sistema abre a escolha de um ônibus reserva livre, inclusive quando o registro legado perdeu o ID da ocorrência. Pausas manuais simples continuam usando o fluxo normal.
- O candidato precisa estar sem escala/reserva em outra linha, sem pane/OS aberta, sem retenção e com condição mecânica estimada mínima de 45%. A seleção também limita a substituição à mesma família operacional do veículo avariado.
- O estoque de Diesel S10 e, quando aplicável, ARLA 32 é conferido antes do despacho. Sem insumo suficiente, a operação não é alterada.
- Ao confirmar, o Visualizador usa o mesmo objeto `replacementDispatch` e o mesmo mecanismo de contagem/chegada já existentes; não foi criado um timer paralelo. A previsão é persistida e o cartão mostra **SUBSTITUTO A CAMINHO**.
- O ônibus original fica associado à sua ocorrência/OS na Garagem. Quando o substituto chega, a rotina já existente valida novamente a disponibilidade e conclui a retomada. Se a reserva ficar indisponível durante o percurso, o despacho é cancelado com segurança e os bloqueios anteriores do veículo original são restaurados.
- Fiscalização reprovada pode ser contornada para a operação somente com um ônibus reserva apto; o veículo reprovado permanece retido. Interdição ativa de via/clima/acidente não pode ser contornada pela troca do veículo.

### Jovem Aprendiz — análise e escala de mecânico
- No momento da autorização, Caio reanalisa o alerta, confirma se ainda está aberto, revalida a OS existente, consulta mecânicos ativos sem outra ordem e recalcula a correspondência entre especialidade, cursos, experiência e nível.
- Em pane urgente, exige dois profissionais diferentes quando há disponibilidade. A escala é registrada na OS real do módulo de oficina, respeitando garagem, serviço, peças necessárias, prazo e Caixa.
- O relatório passa a registrar a nova análise feita após a autorização, o profissional escolhido, o número da OS, o serviço e as peças que devem ser conferidas/compradas. Nenhuma peça é comprada automaticamente.
- A detecção de OS existente também reconhece registros legados por prefixo/empresa para reduzir duplicidades.

### Testes de regressão desta atualização
Foram executados testes unitários isolados em Node para: a camada de reconciliação de uma OS simulada no cenário **Progresso 200 · Torino** com chave/empresa legada; liberação da linha após a conferência; despacho de reserva livre com timer persistido de 25 minutos; compatibilidade de classe; reanálise do mecânico e seleção de dois profissionais distintos em falha urgente; parametrização da criação de OS pelo fluxo de autorização do Jovem Aprendiz; preservação de pausa manual; manutenção do bloqueio quando existe uma segunda OS; substituição de ônibus retido em inspeção; e impedimento de contornar ocorrência ativa que bloqueia a via. `node --check` também foi aprovado.

O navegador Chromium desta sessão bloqueou a navegação para o arquivo local com `ERR_BLOCKED_BY_ADMINISTRATOR`; portanto, os fluxos acima foram validados por testes unitários com dados simulados, não por cliques visuais no site publicado. O registro local real do usuário não foi acessado. A recuperação do caso Progresso 200 foi exercitada com um cenário sintético equivalente (prefixo, modelo, alerta e divergência de chave/empresa); ao instalar, confira a OS e a operação na versão publicada.

## Atualização de 08/11/2026 — substituição autorizada durante parada técnica e relógio civil

### Causa identificada na lógica anterior
O fluxo antigo de “Trocar veículo da operação” foi escrito para uma troca programada no próximo terminal. Ele recusava explicitamente a abertura do seletor quando o ônibus atual tinha pane, ordem de serviço ativa ou retenção de manutenção. Assim, quando o proprietário primeiro encaminhava o veículo à oficina e depois tentava substituí-lo, a própria validação do Visualizador bloqueava a troca. Além disso, pedidos legados de troca ao terminal podiam permanecer pendentes mesmo depois de a linha passar a uma parada técnica, situação na qual o ônibus atual já não conseguiria alcançar o terminal.

### Novo comportamento de substituição sob comando do proprietário
- Em linhas em **Parada técnica** ou **Fora de operação**, o botão **Trocar veículo da operação** abre o seletor mesmo quando o veículo original está em OS, pane ou retenção mecânica/administrativa.
- O proprietário escolhe a empresa e um ônibus livre da frota. A disponibilidade do reserva é validada novamente antes do envio.
- O veículo original deixa de bloquear o registro operacional da linha, mas continua na Garagem com sua OS, pane, ficha e histórico de manutenção preservados. A troca não aprova nem cancela reparos.
- O Visualizador usa o objeto original `replacementDispatch`, com `startedAtMs`, `arrivesAtMs`, `durationMinutes`, `trafficLabel`, prefixo/empresa substitutos e vínculo de inspeção pré-operacional. Não foi criado temporizador paralelo.
- A previsão permanece em minutos reais: trânsito livre 22 min, moderado 25 min, intenso 32 min e muito intenso 40 min. O cartão mostra **SUBSTITUTO A CAMINHO** e a contagem regressiva existente.
- Na chegada, o mecanismo original valida novamente o ônibus de reserva e retoma a linha. A OS e a pane do ônibus antigo permanecem na oficina; aprovar o reparo antigo não remove o ônibus substituto da operação.
- Se existir um pedido legado de troca ao próximo terminal, mas a linha tiver passado para parada técnica antes de o ônibus atual alcançar o terminal, esse pedido pendente é cancelado como substituído por nova ordem do proprietário. A reserva anterior volta a ficar disponível e o seletor direto é reaberto.
- Se já houver um despacho direto ativo e ainda dentro do prazo, o Visualizador mantém o timer em vez de criar uma segunda troca. Se o prazo venceu enquanto a página estava oculta, a reconciliação ao retornar à aba/foco processa a chegada pelo sincronizador existente.
- Pausa manual simples continua seguindo a troca comum no terminal. Acidente, interdição ou condição de via que mantenha um bloqueio de segurança não pode ser liberada apenas por trocar o ônibus. Um veículo reserva que também apresente pane, OS, retenção ou indisponibilidade não será enviado.
- A verificação inicial de combustível foi retirada do momento em que o ônibus é despachado; a checagem de diesel/ARLA continua ocorrendo antes da viagem após a chegada. Assim, falta de insumo não impede registrar o deslocamento, mas ainda impede uma partida sem abastecimento.

### Hora civil real de Brasília e turnos
- O relógio exibido no cartão operacional usa `America/Sao_Paulo`, independente do multiplicador de velocidade da simulação.
- A seleção do motorista de cada nova viagem e a indicação de “Motorista da próxima viagem” usam o turno da hora civil atual: manhã 05:00–11:59; tarde 12:00–17:59; noite 18:00–04:59.
- Se não houver motorista cadastrado para o turno real, o Visualizador informa **Motorista não definido** em vez de atribuir silenciosamente o motorista da manhã ou de outro turno.
- O tempo simulado do percurso e a contabilização de viagens/lucros continuam com a lógica original; a hora civil real determina o turno e o motorista, sem apagar histórico financeiro.

### Testes de regressão desta atualização
Testes automatizados isolados em Node/VM confirmaram: listagem de reserva livre mesmo com OS/pane no veículo antigo; abertura do painel de troca durante parada técnica; execução do clique de confirmação pelo fluxo de captura; criação do despacho com timer moderado de 25 minutos; persistência do novo prefixo no vínculo operacional; preservação da OS antiga e do alerta mecânico; conclusão pelo manipulador original de chegada, limpando o timer e retomando a linha; recuperação de pedido legado ao terminal quando a linha já está em parada técnica; e escolha do motorista do turno real calculado pelo fuso `America/Sao_Paulo`. `node --check` também foi aprovado.

O Chromium desta sessão bloqueou a navegação local com `ERR_BLOCKED_BY_ADMINISTRATOR`; portanto, os testes de fluxo foram feitos em VM isolada com as funções e estados reais do módulo, não por cliques visuais no navegador. A versão publicada e o armazenamento local do usuário não foram acessados. A troca exige um ônibus reserva livre e operacional; ela não libera interdição de via nem autoriza rodar com um veículo que também esteja em manutenção.


## Remoção de módulos e desempenho (2026-11-11)
- Removidos exclusivamente do menu e da interface: Simular arrecadação, Controle de manutenção (tela antiga de lembretes), Fluxo de passageiros por parada e Pontualidade da linha.
- A remoção não apaga registros que já existam no armazenamento local. Os lembretes legados de manutenção continuam disponíveis para integração com a Agenda de Frota.
- Otimizada a navegação com cache das telas e suspensa a sincronização por segundo do Visualizador enquanto a aba está oculta. Ao retornar à aba, o relógio persistente recupera o tempo decorrido.
