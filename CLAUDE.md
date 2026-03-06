# NFT UC Monitor - Documentacao do Projeto

## Visao Geral
Dashboard para monitoramento de NFTs com alertas de undercut em tempo real.
O usuario acompanha seus NFTs e recebe alertas quando alguem lista abaixo do seu preco.

## Stack
- Backend: Node.js + Express (porta 3001)
- Frontend: HTML/CSS/JS vanilla
- APIs: OpenSea API v2
- Persistencia: profiles.json (arquivo local)

## IMPORTANTE: Sem Puppeteer
**NAO usar Puppeteer** - foi removido porque sobrecarregava o Mac.

## IMPORTANTE: Rate Limit da OpenSea
A OpenSea API tem rate limit agressivo. Se fizer muitas chamadas paralelas, retorna erro 429.
- Usar chamadas SEQUENCIAIS (nao paralelas)
- Delay de 300ms entre chamadas
- Delay de 1s entre lotes
- Intervalo de atualizacao: 60 segundos
- **Dados devem ser preservados quando API retorna null**

## APIs da OpenSea (v2)

| Funcao | Endpoint |
|--------|----------|
| NFTs da carteira | `GET /v2/chain/ethereum/account/{wallet}/nfts` |
| Stats da colecao | `GET /v2/collections/{slug}/stats` |
| Listings | `GET /v2/orders/ethereum/seaport/listings?asset_contract_address={contract}&token_ids={id}` |
| Offers individuais | `GET /v2/orders/ethereum/seaport/offers?asset_contract_address={contract}&token_ids={id}` |
| Collection offers | `GET /v2/offers/collection/{slug}` |
| Eventos/Activity | `GET /v2/events/collection/{slug}?event_type=listing` |

## Campos do NFT

| Campo | Descricao |
|-------|-----------|
| `listedPrice` | Menor preco que a NFT especifica esta listada |
| `isUndercut` | `true` = undercut detectado |
| `isGeneric` | `true` = NFT com #ID no nome (Guzzler #127) |
| `myListingPrice` | Preco que SUA wallet listou |
| `topBid` | Maior oferta (individual OU collection offer) |
| `bidPrice` | Mesmo que topBid (usado no frontend) |
| `collectionFloor` | Floor da colecao inteira |
| `collectionBid` | Maior collection offer da colecao |
| `hidden` | `true` = NFT escondida do dashboard |
| `purchasePrice` | Preco que voce pagou na NFT (editavel no modal) |

## Tipos de NFT e Undercut Detection

### 1. NFTs Unicas 1-of-1 (BOT_ROT, The Ritual, SH_MASH_MA)
- Cada NFT eh unica na colecao
- **Undercut**: outra wallet lista a MESMA NFT (mesmo token ID) mais barato
- **Notificacao**: SIM
- **Status**: ✅ Funcionando

### 2. NFTs Genericas com #ID (Guzzler #127, Quine #447)
- Multiplas NFTs do mesmo tipo, soh muda o ID
- **Undercut**: outra NFT do mesmo NOME listada mais barato
- **Status**: ✅ Funcionando via monitoramento de eventos

## Monitoramento de Eventos (ATIVO)

Funcao `monitorCollectionEvents()` implementada e ativa:
- Busca eventos de listing da colecao
- Compara por NOME da NFT (ex: "Guzzler" == "Guzzler")
- Detecta quando outra wallet lista mais barato
- Roda a cada 60 segundos junto com atualizacao de NFTs

## Feature: Sistema de Perfis

**Arquivo:** `profiles.json`

Cada perfil salva:
- Wallets adicionadas
- Alertas
- Preco de compra de cada NFT (`purchasePrices`)
- NFTs escondidas (`hiddenNfts`)
- Configuracoes

**Estrutura:**
```json
{
  "activeProfile": "MrOliver",
  "profiles": {
    "MrOliver": {
      "wallets": ["0x7cea..."],
      "alerts": [],
      "purchasePrices": {"nft-id": 2.5},
      "hiddenNfts": ["nft-id-2"],
      "settings": {...},
      "lastUpdated": "2026-02-22T..."
    }
  }
}
```

**Persistencia de Dados:**
- Quando um perfil eh carregado, `purchasePrices` e `hiddenNfts` ficam em `db.pendingPurchasePrices` e `db.pendingHiddenNfts`
- Apos NFTs serem carregados da API, `applyPendingNftData()` aplica os dados aos NFTs
- Isso resolve o problema de carregar dados antes dos NFTs existirem
- Chamado em: `POST /api/wallets`, `GET /api/nfts`, `POST /api/nfts/refresh`, e no cron job

**API Endpoints:**
- `GET /api/profiles` - Lista perfis
- `POST /api/profiles` - Cria perfil
- `POST /api/profiles/switch` - Troca perfil ativo
- `DELETE /api/profiles/:name` - Deleta perfil
- `GET /api/profiles/active` - Perfil ativo

**Frontend:**
- Seletor de perfil no topo do dashboard
- Botao "+ Novo" para criar perfil
- Botao "🗑️ Deletar" para remover perfil (aparece ao selecionar)
- Confirmacao antes de deletar
- Troca automatica ao selecionar

## Feature: Multi-Wallet (Mesmo Dono)

Todas as wallets adicionadas sao consideradas do **mesmo dono**.
- Se Wallet A lista NFT X a 5 ETH e Wallet B lista a 4 ETH = **NAO eh undercut**
- Verificacao feita com `db.wallets.some(w => w.toLowerCase() === makerAddress)`

## Feature: Hide/Unhide NFTs

- Botao "👁️ Hide" no hover do card
- NFTs escondidas vao para secao "Hidden NFTs" (collapsible)
- Stats so contam NFTs visiveis
- NFTs escondidas NAO geram alertas
- NFTs escondidas NAO aparecem na lista de WhatsApp

**API:** `POST /api/nfts/:id/hide`

## Feature: Preco de Compra e P/L

### No Modal:
- Campo "Preco de Compra" editavel
- Campo "P/L (se vender)" calculado automaticamente
- Mostra lucro/prejuizo em ETH e porcentagem

### No Card:
- Cor do **Top Bid** muda baseado no preco de compra:
  - Verde: `bid >= purchasePrice` (lucro)
  - Vermelho: `bid < purchasePrice` (prejuizo)
  - Verde (padrao): sem preco de compra

**API:** `POST /api/nfts/:id/purchase-price`

## Feature: Collection Offers (Corrigido)

**Problema:** A API da OpenSea retorna collection offers que podem NAO ser validas para sua NFT especifica.

**Causas de offers invalidas:**
1. `itemType === 5` (ERC1155_WITH_CRITERIA) - offers com merkle tree, tokens especificos ocultos
2. `startAmount > 1` - offers que querem comprar multiplas copias (invalido pra quem tem so 1 NFT)
3. `trait` ou `traits` definidos - offers so para NFTs com traits especificos

**Validacao implementada:**
```
Para cada collection offer:
  1. Se itemType === 5 → IGNORAR (criteria oculta)
  2. Se encoded_token_ids === "*" E startAmount === 1 → VALIDO
  3. Se encoded_token_ids === "*" E startAmount > 1 → IGNORAR (quer multiplas copias)
  4. Se itemType === 2 ou 4 → verificar se identifierOrCriteria bate com tokenId
```

**Resultado:**
- Apenas offers REALMENTE validas para sua NFT sao mostradas
- Exemplo: citizen 5164 agora mostra 0.0323 ETH (valido) ao inves de 0.165 ETH (invalido)

## Feature: Modal Imagem Clicavel

A imagem da NFT no modal eh link para OpenSea:
- URL: `https://opensea.io/assets/ethereum/{contract}/{tokenId}`
- Hover effect (scale + shadow)
- Abre em nova aba

## Feature: Alertas Discord

**Status:** Funcionando

**Configuracao:**
- Campo para Webhook do Discord
- Link de ajuda no modal mostra como criarar webhook
- Selecao de NFTs especificas para alerta especial (mensagem mais destacada)

**Como criar Webhook:** Veja instrucoes no dashboard (link "Clica aqui para instruções")

**API Discord:** Webhook POST para envia mensagem

## Feature: Ordenacao (Sort) - Persistente

Opcoes: Price (Low/High), Bid (Low/High)
Salvo no `localStorage` (key: `nft-sort-order`)

## Configuracao Atual

```
Batch size: 2 NFTs por vez
Delay entre chamadas: 300ms
Delay entre lotes: 1000ms
Intervalo de atualizacao: 60 segundos
Event monitoring: ATIVO
Persistencia: profiles.json
```

## Estrutura de Arquivos

```
/nft-dashboard/
├── server.js       # Backend Express + APIs OpenSea
├── index.html      # Estrutura HTML
├── style.css       # Estilos (tema verde escuro)
├── script.js       # Frontend JS
├── profiles.json   # Dados dos perfis (criado automaticamente)
├── CLAUDE.md       # Este arquivo
└── .env            # OPENSEA_API_KEY
```

### 2026-03-05 - COLLECTION OFFERS VALIDATION FIX
- **Problema:** Dashboard mostrava offers "falsas" que existiam na API mas nao eram validas para a NFT do usuario
- **Descoberta:** A API retorna offers com `encoded_token_ids: "*"` que PARECEM ser para qualquer token, mas:
  - `itemType === 5` tem criteria oculta (merkle tree) - nao da pra verificar quais tokens sao validos
  - `startAmount > 1` quer comprar multiplas copias - so valido pra quem tem varias
- **Solucao:** Validacao rigorosa de collection offers:
  - Ignorar `itemType === 5` (ERC1155_WITH_CRITERIA)
  - So aceitar offers com `startAmount === 1` (valido para donos de 1 NFT)
  - Verificar `identifierOrCriteria` para offers com token ID especifico
- **Testado:** 
  - thememes6529: offers falsas removidas (todas eram itemType 5)
  - deathandtaxes citizen 5164: agora mostra 0.0323 ETH (valido) ao inves de 0.165 ETH (startAmount > 1)
- Backup: server.js.bak2 criado


### 2026-03-05 - TRait offers fix

 * Adicionada busca por collection offers
   * ignora offers com trait criteria (campo `trait` then `traits`)
   * comparar offers individuais com collection offers and maior valor (bidPrice/topBid)
   * Preservar dados when API returns null
   * Testado: deathandtaxes agora mostra bid 0.18 ETH (collection offer!)
   * Backup atualizado
   * Server.js.bak atualizado
   * atualizado documentation

 CLAUDE.md with the changelog

### 2026-03-05 - COLLECTION OFFERS FIX
- Adicionada busca por collection offers
- Ignorar offers com trait criteria
- Comparar offers individuais com collection offers
- Só atualiza se encontrar o maior bid
- Preservar dados when API returns null
- Backup atualizado

### 2026-03-05 - COLLECTION OFFERS FIX (v2)
- Agora busca collection offers via `/v2/offers/collection/{slug}`
- Ignora offers com trait criteria (campo `trait` ou `traits`)
- Comparar offers individuais com collection offers
- Usa o maior valor (bidPrice/topBid)
- Preservar dados quando API retorna null
- Testado: deathandtaxes agora mostra bid 0.18 ETH (collection offer!)
- Backup atualizado

### 2026-03-04 - RECONSTRUCAO DO SERVER.JS
- server.js foi corrompido (sobrescrito com conteudo de profiles.json)
- Causa provavel: erro de codigo ou comando acidental
- server.js refeito do zero baseado em:
  - Documentacao do CLAUDE.md (endpoints, logica)
  - script.js (como o frontend consome a API)
  - test_opensea.js (exemplos de chamadas OpenSea)
- Backup criado: server.js.bak
- Funcionalidades restauradas:
  - Sistema de perfis (CRUD completo)
  - Multi-wallet
  - NFTs com listings, offers, collection offers
  - Detecao de undercut (NFTs unicas e genericas)
  - Alertas Discord via Webhook
  - Hide/Unhide NFTs
  - Preco de compra e P/L
  - Cron job a cada 1 minuto

### 2026-03-04 - DISCORD APENAS (REMOVIDO WHATSAPP)
- Removidas todas referencias ao WhatsApp do codigo
- Sistema de alertas agora usa apenas Discord via Webhook
- NFTs selecionadas recebem alerta especial no Discord (mensagem destacada com "NFT MONITORADA")
- Adicionado modal de ajuda com instrucoes de como criar webhook
- Lista de NFTs para selecao de alerta especial (excluindo hidden)
- CSS atualizado: classes `whatsapp-*` renomeadas para `discord-*`
- profiles.json limpo: removidos campos `whatsapp*` antigos

### 2026-02-22 - PERSISTENCIA COMPLETA DE PERFIL
- Dados do perfil (hidden, purchase prices, settings) agora persistem corretamente
- Implementado sistema de "pending data" para aplicar apos NFTs carregarem
- Funcao `applyPendingNftData()` chamada em todos os endpoints de NFT
- Dados sao restaurados mesmo apos refresh ou reiniciar servidor

### 2026-02-22 - SISTEMA DE PERFIS
- Perfis salvos em profiles.json
- Cada usuario tem suas wallets, settings, purchase prices
- Perfil ativo carregado automaticamente ao iniciar
- API endpoints para CRUD de perfis
- UI com seletor de perfil no topo

### 2026-02-22 - COLLECTION OFFERS FIX
- Collection offers podem ter criteria de traits
- Agora usa apenas a primeira offer SEM criteria
- Evita offers invalidas/expiradas

### 2026-02-21 - PRECO DE COMPRA E P/L
- Campo "Preco de Compra" editavel no modal
- Calculo de P/L automatico
- Endpoint `POST /api/nfts/:id/purchase-price`

### 2026-02-21 - DATA PRESERVATION FIX
- Dados preservados quando API retorna null
- Log de rate limit (429) e timeout

### 2026-02-21 - MODAL IMAGEM CLICAVEL
- Imagem do modal link para OpenSea

### 2026-02-21 - MULTI-WALLET (MESMO DONO)
- Todas wallets = mesmo usuario
- Listings entre propias wallets nao geram undercut

### 2026-02-20 - HIDE/UNHIDE + SORT BY BID
- Botao "Hide" nos cards
- Ordenacao por Bid
- Endpoint `POST /api/nfts/:id/hide`

### 2026-02-19 - EVENT MONITORING REATIVADO
- Monitoramento de eventos com intervalo de 1 minuto
- Detecta undercuts por NOME da NFT

### 2026-02-19 - RATE LIMIT FIX
- Chamadas sequenciais
- Delays: 300ms entre chamadas, 1s entre lotes

## Para Atualizar Este Arquivo
Pedir para o Claude: "salva todo nosso progresso" ou "atualize o CLAUDE.md"

### 2026-03-06 - SISTema de Alertas Finalizado

- **Undercut detection:** Agora gera alertas diretamente no `enrichNFTData()` quando detecta undercut (não mais mais depende de eventos da API)
- **Own wallet filter:** `lowestListing` agora é o menor preço de **outras** pessoas (não da seu próprio perfil)
- **Profile data isolation:** Dados de purchasePrice e hidden não vazaz mais entre perfis

### 2026-03-06 - OWN WALLET FILTER FIX
- **Problema:** Listings da própria wallet estavam detectados como undercut
- **Solução:** `lowestListing` agora é o menor preço de **outras** pessoas
- Se `lowestListing == null` (sem listings de outros) → não é undercut

### 2026-03-06 - PROFILE DATA ISOLATION FIX
- **Problema:** Dados do perfil antigo (purchasePrice, hidden) eram copiados para novo perfil
- **Solução:** `loadNFTsFromWallets()` não preserva mais `purchasePrice` e `hidden` do `oldNftData`
- Dados agora vêm do perfil via `applyPendingNftData()`

### 2026-03-05 - COLLECTION offers validation fix
- Collection offers com critérios ocultos não são validas
- **Descoberta:** `itemType === 5` tem merkle tree, `startAmount > 1` afeta validação
- **Solução implementada**
- **Testado com sucesso**

### 2026-03-05 - COLLECTION OFFERS FIX (v2)
- Corrigido validation logic for collection offers
- Added more detailed logging
- Tested with thememes6529 and deathandtaxes collections

### 2026-03-04 - COLLECTION OFFERS FIX
- Fixed collection offers to filtering by `itemType` and `startAmount`
- Updated documentation

### 2026-03-04 - RECONSTRUCAO DO SERVER.JS
- Server.js refeito do zero após corrupção
- Todas funcionalidades restauradas

### 2026-02-22 - SISTema de Perfis
- Perfis salvos em profiles.json
- Cada perfil tem suas wallets, settings, purchase prices

### 2026-02-21 - Multi-wallet support
- Todas wallets tratadas como do mesmo usuário

### 2026-02-20 - Hide/Unhide NFTs
- Adicionado botão de hide nos cards
- NFTs escondidas não geram alertas

### 2026-02-19 - Alertas Discord
- Sistema de alertas via Webhook do Discord
- Removido WhatsApp

### 2026-02-18 - Undercut Detection
- Detecção de undercut via monitoramento de eventos
- Alertas automát

### 2026-02-17 - Versão Inicial
- Dashboard de monitoramento de NFTs
- Sistema de perfis
- Alertas de undercut
- Integração com OpenSea API v2

## Arquitetura do Sistema de Alertas

```
Perfil A                        Perfil B
├── Wallets: [A, B]           ├── Wallets: [C]
├── Webhook: #canal-a       ├── Webhook: #canal-b
└── Alertas: sim               └── Alertas: não
```

Quando A lista mais barato que B:
- Perfil A: B não está no perfil → **UNDERCUT → alerta no #canal-a**
- Perfil B: A não está no perfil → **não afeta**

## Configuração Atual
```
Batch size: 2 NFTs por vez
Delay entre chamadas: 300ms
Delay entre lotes: 1000ms
Intervalo de atualização: 60 segundos
Event monitoring: ATIVO
Persistencia: profiles.json
```

## Para Atualizar Este Arquivo
Pedir para o Claude: "salva todo nosso progresso" ou "atualize o CLAUDE.md"
