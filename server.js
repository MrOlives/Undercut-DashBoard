// ===========================================
// NFT UNDERCUT MONITOR - BACKEND
// ===========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// OpenSea API
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const OPENSEA_BASE_URL = 'https://api.opensea.io/api/v2';
console.log('[STARTUP] OPENSEA_API_KEY carregada:', OPENSEA_API_KEY ? 'SIM (' + OPENSEA_API_KEY.substring(0, 8) + '...)' : 'NÃO!');

// ===========================================
// DATABASE (profiles.json)
// ===========================================
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const WEBHOOKS_FILE = path.join(__dirname, 'webhooks.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'admin123'; // Vem do .env
console.log('[STARTUP] ADMIN_PASS carregada:', process.env.ADMIN_PASS ? 'SIM (do env)' : 'NÃO (usando fallback admin123)');
console.log('[STARTUP] Valor da senha (primeiros 3 chars):', ADMIN_PASSWORD.substring(0, 3) + '...');

function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            const data = fs.readFileSync(PROFILES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar profiles.json:', error);
    }
    return { activeProfile: null, profiles: {} };
}

function saveProfiles(data) {
    try {
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Erro ao salvar profiles.json:', error);
    }
}

// Webhooks admin (mapeamento perfil -> webhook)
function loadWebhooks() {
    try {
        if (fs.existsSync(WEBHOOKS_FILE)) {
            const data = fs.readFileSync(WEBHOOKS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar webhooks.json:', error);
    }
    return {};
}

function saveWebhooks(data) {
    try {
        fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Erro ao salvar webhooks.json:', error);
    }
}

// In-memory state
let db = {
    nfts: [],
    alerts: [],
    pendingPurchasePrices: {},
    pendingHiddenNfts: [],
    wallets: []
};

// ===========================================
// PERFIS
// ===========================================
app.get('/api/profiles', (req, res) => {
    const data = loadProfiles();
    const profiles = Object.keys(data.profiles).map(name => ({
        name,
        walletCount: data.profiles[name].wallets?.length || 0
    }));
    res.json({ profiles, activeProfile: data.activeProfile });
});

app.post('/api/profiles', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const data = loadProfiles();
    if (data.profiles[name]) {
        return res.status(400).json({ error: 'Perfil já existe' });
    }

    data.profiles[name] = {
        wallets: [],
        alerts: [],
        purchasePrices: {},
        hiddenNfts: [],
        settings: {
            alertDashboard: true,
            alertDiscord: false,
            discordWebhook: '',
            discordNfts: [],
            checkInterval: 5
        },
        lastUpdated: new Date().toISOString()
    };

    saveProfiles(data);
    res.json({ success: true, profile: data.profiles[name] });
});

app.post('/api/profiles/switch', (req, res) => {
    const { name } = req.body;
    const data = loadProfiles();

    if (!data.profiles[name]) {
        return res.status(404).json({ error: 'Perfil não encontrado' });
    }

    data.activeProfile = name;
    data.profiles[name].lastUpdated = new Date().toISOString();
    saveProfiles(data);

    // Carregar dados do perfil
    const profile = data.profiles[name];
    db.wallets = profile.wallets || [];
    db.pendingPurchasePrices = profile.purchasePrices || {};
    db.pendingHiddenNfts = profile.hiddenNfts || [];

    res.json({ success: true });
});

app.delete('/api/profiles/:name', (req, res) => {
    const { name } = req.params;
    const data = loadProfiles();

    if (!data.profiles[name]) {
        return res.status(404).json({ error: 'Perfil não encontrado' });
    }

    delete data.profiles[name];

    if (data.activeProfile === name) {
        data.activeProfile = null;
    }

    saveProfiles(data);
    res.json({ success: true });
});

// ===========================================
// ADMIN - Gerenciamento de Webhooks
// ===========================================
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    console.log('[ADMIN LOGIN] Tentativa de login');
    console.log('[ADMIN LOGIN] Senha recebida:', JSON.stringify(password));
    console.log('[ADMIN LOGIN] Senha esperada:', JSON.stringify(ADMIN_PASSWORD));
    console.log('[ADMIN LOGIN] Tamanho recebida:', password?.length, 'Tamanho esperada:', ADMIN_PASSWORD?.length);
    if (password === ADMIN_PASSWORD) {
        console.log('[ADMIN LOGIN] Sucesso!');
        res.json({ success: true });
    } else {
        console.log('[ADMIN LOGIN] Falhou - senhas diferentes');
        res.status(401).json({ error: 'Senha incorreta' });
    }
});

app.get('/api/admin/profiles', (req, res) => {
    const data = loadProfiles();
    const webhooks = loadWebhooks();

    const profiles = Object.keys(data.profiles).map(name => ({
        name,
        walletCount: data.profiles[name].wallets?.length || 0,
        hasWebhook: !!webhooks[name],
        alertDiscord: data.profiles[name].settings?.alertDiscord || false
    }));

    res.json({ profiles });
});

app.post('/api/admin/webhook', (req, res) => {
    const { profileName, webhook } = req.body;

    if (!profileName) {
        return res.status(400).json({ error: 'Nome do perfil é obrigatório' });
    }

    const data = loadProfiles();
    if (!data.profiles[profileName]) {
        return res.status(404).json({ error: 'Perfil não encontrado' });
    }

    const webhooks = loadWebhooks();

    if (webhook && webhook.trim()) {
        webhooks[profileName] = webhook.trim();
    } else {
        delete webhooks[profileName];
    }

    saveWebhooks(webhooks);
    res.json({ success: true });
});

app.delete('/api/admin/webhook/:profileName', (req, res) => {
    const { profileName } = req.params;

    const webhooks = loadWebhooks();
    delete webhooks[profileName];
    saveWebhooks(webhooks);

    res.json({ success: true });
});

// ===========================================
// WALLETS
// ===========================================
app.get('/api/wallets', (req, res) => {
    const data = loadProfiles();
    const profile = data.profiles[data.activeProfile];

    if (!profile) {
        return res.json({ wallets: [] });
    }

    db.wallets = profile.wallets || [];
    res.json({ wallets: db.wallets });
});

app.post('/api/wallets', async (req, res) => {
    const { address } = req.body;
    const data = loadProfiles();

    if (!data.activeProfile) {
        return res.status(400).json({ error: 'Nenhum perfil ativo' });
    }

    const profile = data.profiles[data.activeProfile];
    if (!profile.wallets) profile.wallets = [];

    if (!profile.wallets.includes(address)) {
        profile.wallets.push(address);
        profile.lastUpdated = new Date().toISOString();
        saveProfiles(data);
    }

    db.wallets = profile.wallets;
    db.pendingPurchasePrices = profile.purchasePrices || {};
    db.pendingHiddenNfts = profile.hiddenNfts || [];

    // Carregar NFTs da nova wallet
    await loadNFTsFromWallets();

    res.json({ success: true, wallets: db.wallets });
});

app.delete('/api/wallets/:address', (req, res) => {
    const { address } = req.params;
    const data = loadProfiles();

    if (!data.activeProfile) {
        return res.status(400).json({ error: 'Nenhum perfil ativo' });
    }

    const profile = data.profiles[data.activeProfile];
    profile.wallets = profile.wallets.filter(w => w !== address);
    profile.lastUpdated = new Date().toISOString();
    saveProfiles(data);

    db.wallets = profile.wallets;
    res.json({ success: true });
});

// ===========================================
// OPENSEA API - Rate Limiter
// ===========================================
// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// OpenSea v2: ~5 requests/segundo (conservador)
const RATE_LIMIT = {
    minInterval: 300,  // 300ms entre requests = max ~3/segundo
    lastRequest: 0
};

async function openSeaRequest(endpoint, params = {}) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - RATE_LIMIT.lastRequest;
    const waitTime = Math.max(0, RATE_LIMIT.minInterval - timeSinceLastRequest);
    if (waitTime > 0) {
        await delay(waitTime);
    }
    RATE_LIMIT.lastRequest = Date.now();

    console.log(`[API] Chamando: ${endpoint}`);
    console.log(`[API] API Key (length): ${OPENSEA_API_KEY?.length}, starts with: ${OPENSEA_API_KEY?.substring(0, 8)}...`);
    try {
        const response = await axios.get(`${OPENSEA_BASE_URL}${endpoint}`, {
            headers: {
                'x-api-key': OPENSEA_API_KEY,
                'Accept': 'application/json'
            },
            params
        });
        console.log(`[API] Sucesso: ${endpoint}`);
        return response.data;
    } catch (error) {
        if (error.response?.status === 401) {
            console.error(`[API] 401 UNAUTHORIZED - API Key inválida ou sem permissão`);
            console.error(`[API] Resposta:`, error.response?.data);
        }
        if (error.response?.status === 429) {
            console.log(`[API] Rate limit (429) em ${endpoint}, aguardando 2s...`);
            await delay(2000);
            // Tentar novamente após wait
            RATE_LIMIT.lastRequest = 0; // Reset para permitir nova tentativa
            return openSeaRequest(endpoint, params);
        } else if (error.response?.status !== 404) {
            console.error(`[API] ERRO ${endpoint}:`, error.response?.status, error.message);
        } else {
            console.log(`[API] 404 em ${endpoint} (normal para alguns endpoints)`);
        }
        return null;
    }
}

// ===========================================
// NFTs
// ===========================================
async function getNFTsFromWallet(wallet) {
    console.log(`[NFT] Buscando NFTs da wallet: ${wallet}`);
    const data = await openSeaRequest(`/chain/ethereum/account/${wallet}/nfts`);
    console.log(`[NFT] Resposta da API:`, data ? `${data.nfts?.length || 0} NFTs encontradas` : 'null/erro');
    return data?.nfts || [];
}

async function getCollectionStats(slug) {
    const data = await openSeaRequest(`/collections/${slug}/stats`);
    return data;
}

async function getListings(contract, tokenId) {
    const data = await openSeaRequest('/orders/ethereum/seaport/listings', {
        asset_contract_address: contract,
        token_ids: tokenId
    });
    return data?.orders || [];
}

async function getOffers(contract, tokenId) {
    const data = await openSeaRequest('/orders/ethereum/seaport/offers', {
        asset_contract_address: contract,
        token_ids: tokenId
    });
    return data?.orders || [];
}

async function getCollectionOffers(slug) {
    const data = await openSeaRequest(`/offers/collection/${slug}`);
    return data?.offers || [];
}

async function getCollectionEvents(slug) {
    const data = await openSeaRequest(`/events/collection/${slug}`, {
        event_type: 'listing'
    });
    return data?.asset_events || [];
}

// Aplicar dados pendentes (purchase prices e hidden) aos NFTs
function applyPendingNftData() {
    db.nfts.forEach(nft => {
        // Aplicar purchase price
        if (db.pendingPurchasePrices[nft.id]) {
            nft.purchasePrice = db.pendingPurchasePrices[nft.id];
        }
        // Aplicar hidden
        if (db.pendingHiddenNfts.includes(nft.id)) {
            nft.hidden = true;
        }
    });
}

// Carregar NFTs de todas as wallets
async function loadNFTsFromWallets() {
    console.log(`[LOAD] Iniciando carregamento de NFTs...`);
    console.log(`[LOAD] Wallets registradas:`, db.wallets);

    if (!db.wallets || db.wallets.length === 0) {
        console.log(`[LOAD] ERRO: Nenhuma wallet registrada!`);
        return;
    }

    // Preservar dados antigos dos NFTs
    // Preservar apenas dados de preco (purchasePrice e hidden vêm do perfil)
    const oldNftData = {};
    for (const nft of db.nfts) {
        oldNftData[nft.id] = {
            listedPrice: nft.listedPrice,
            myListingPrice: nft.myListingPrice,
            bidPrice: nft.bidPrice,
            topBid: nft.topBid,
            isUndercut: nft.isUndercut
        };
    }

    const allNfts = [];

    for (const wallet of db.wallets) {
        const nfts = await getNFTsFromWallet(wallet);

        for (const nft of nfts) {
            const nftId = `${nft.contract}-${nft.identifier}`;
            const newNft = {
                id: nftId,
                contract: nft.contract,
                tokenId: nft.identifier,
                name: nft.name,
                collectionName: nft.collection,
                image: nft.image_url,
                owner: wallet,
                traits: nft.traits || []
            };

            // Restaurar dados de preco antigos (purchasePrice e hidden vêm do perfil)
            if (oldNftData[nftId]) {
                newNft.listedPrice = oldNftData[nftId].listedPrice;
                newNft.myListingPrice = oldNftData[nftId].myListingPrice;
                newNft.bidPrice = oldNftData[nftId].bidPrice;
                newNft.topBid = oldNftData[nftId].topBid;
                newNft.isUndercut = oldNftData[nftId].isUndercut;
            }

            allNfts.push(newNft);
        }
    }

    db.nfts = allNfts;
    applyPendingNftData();

    // Buscar dados de listings/offers em lotes
    await enrichNFTData();
}

// Enriquecer NFTs com dados de preço
async function enrichNFTData() {
    const batchSize = 2;
    const nfts = db.nfts.filter(n => !n.hidden);

    for (let i = 0; i < nfts.length; i += batchSize) {
        const batch = nfts.slice(i, i + batchSize);

        for (const nft of batch) {
            try {
                // Buscar listings - só atualiza se a API responder
                const listings = await getListings(nft.contract, nft.tokenId);

                if (listings !== null && listings !== undefined) {
                    let lowestListing = null;
                    let myListing = null;

                    for (const listing of listings) {
                        const price = parseFloat(listing.current_price) / 1e18;
                        const maker = listing.maker?.address?.toLowerCase();

                        if (!lowestListing || price < lowestListing) {
                            lowestListing = price;
                        }

                        if (db.wallets.some(w => w.toLowerCase() === maker)) {
                            if (!myListing || price < myListing) {
                                myListing = price;
                            }
                        }
                    }

                    // Só atualiza se encontrou algum listing
                    if (lowestListing !== null) {
                        nft.listedPrice = lowestListing;
                    }
                    if (myListing !== null) {
                        nft.myListingPrice = myListing;
                    }

                    // Detectar undercut
                    if (lowestListing && myListing) {
                        const wasUndercut = nft.isUndercut;
                        nft.isUndercut = lowestListing < myListing;

                        // Criar alerta se novo undercut detectado
                        if (nft.isUndercut && !wasUndercut) {
                            await createUndercutAlert(nft, lowestListing);
                        }
                    }
                }

                // Buscar offers individuais
                const offers = await getOffers(nft.contract, nft.tokenId);

                let highestOffer = 0;
                if (offers !== null && offers !== undefined && offers.length > 0) {
                    for (const offer of offers) {
                        const price = parseFloat(offer.current_price) / 1e18;

                        // Verificar se é offer para múltiplas NFTs (ignorar)
                        // O campo startAmount indica quantas cópias o comprador quer
                        const protocolStartAmount = parseInt(offer.protocol_data?.parameters?.consideration?.[0]?.startAmount || 1);

                        // Ignorar offers que querem múltiplas cópias (preço é total, não por NFT)
                        if (protocolStartAmount > 1) {
                            continue;
                        }

                        if (price > highestOffer) {
                            highestOffer = price;
                        }
                    }
                }

                // Buscar collection offers (incluindo trait offers)
                const collectionOffers = await getCollectionOffers(nft.collectionName);

                let bestCollectionOffer = 0;
                let bestTraitOffer = 0;

                if (collectionOffers && collectionOffers.length > 0) {
                    for (const co of collectionOffers) {
                        const price = parseFloat(co.price?.value) / Math.pow(10, co.price?.decimals || 18);
                        const traitCriteria = co.criteria?.trait || co.criteria?.traits;

                        // Verificar se a offer é válida para ESTA NFT específica
                        const consideration = co.protocol_data?.parameters?.consideration?.[0];
                        const itemType = consideration?.itemType;
                        const identifierOrCriteria = consideration?.identifierOrCriteria;
                        const encodedTokenIds = co.criteria?.encoded_token_ids;
                        const startAmount = parseInt(consideration?.startAmount || 1);

                        // itemType 5 = ERC1155_WITH_CRITERIA (merkle tree, tokens específicos ocultos)
                        // itemType 4 = ERC1155
                        // itemType 2 = ERC721
                        // encoded_token_ids: "*" = válido para qualquer token da coleção
                        // startAmount = quantidade que o comprador quer (se > 1, IGNORAR - preço total, não por NFT)

                        let isValidForThisNft = false;

                        // SEMPRE ignorar ofertas que querem múltiplas cópias (preço é total, não por NFT)
                        if (startAmount > 1) {
                            isValidForThisNft = false;
                        } else if (itemType === 5) {
                            // Criteria-based offer - não podemos verificar quais tokens são válidos
                            isValidForThisNft = false;
                        } else if (encodedTokenIds === "*" && startAmount === 1) {
                            // Offer para qualquer token da coleção, querendo 1 cópia = válido
                            isValidForThisNft = true;
                        } else if (itemType === 4 || itemType === 2) {
                            // ERC1155 ou ERC721 - verificar se é para o token ID correto
                            const offerTokenId = String(identifierOrCriteria);
                            const nftTokenId = String(nft.tokenId);
                            isValidForThisNft = offerTokenId === nftTokenId;
                        }
                        // Não há mais fallback - se não se encaixar nos critérios acima, é inválido

                        if (!traitCriteria && isValidForThisNft) {
                            // Collection offer válida para esta NFT
                            if (price > bestCollectionOffer) {
                                bestCollectionOffer = price;
                            }
                        } else if (isValidForThisNft) {
                            // Trait offer = verificar se a NFT tem esse trait
                            if (nft.traits && nft.traits.length > 0) {
                                const hasTrait = nft.traits.some(t => {
                                    // trait pode ser string "Background: Blue" ou objeto {trait_type, value}
                                    if (typeof traitCriteria === 'string') {
                                        const [traitType, traitValue] = traitCriteria.split(':').map(s => s.trim());
                                        return t.trait_type === traitType && t.value === traitValue;
                                    }
                                    if (traitCriteria.trait_type && traitCriteria.value) {
                                        return t.trait_type === traitCriteria.trait_type && t.value === traitCriteria.value;
                                    }
                                    return false;
                                });
                                if (hasTrait && price > bestTraitOffer) {
                                    bestTraitOffer = price;
                                }
                            }
                        }
                    }
                }

                // Comparar item offer, collection offer e trait offer - usar o maior
                const finalBid = Math.max(highestOffer, bestCollectionOffer, bestTraitOffer);
                console.log(`${nft.name}: item=${highestOffer}, collection=${bestCollectionOffer}, trait=${bestTraitOffer}, final=${finalBid}`);
                if (finalBid > 0) {
                    nft.bidPrice = finalBid;
                    nft.topBid = finalBid;
                }

            } catch (error) {
                console.error(`Erro ao processar NFT ${nft.id}:`, error.message);
            }
        }

        // Delay entre lotes
        if (i + batchSize < nfts.length) {
            await delay(1000);
        }
    }

    // Monitorar eventos para detectar undercuts
    await monitorCollectionEvents();
}

// Monitorar eventos de listing
async function monitorCollectionEvents() {
    const collections = [...new Set(db.nfts.map(n => n.collectionName))];

    for (const collection of collections) {
        if (!collection) continue;

        try {
            const events = await getCollectionEvents(collection);

            for (const event of events || []) {
                const eventNft = event.nft;
                if (!eventNft) continue;

                const eventName = eventNft.name || '';
                const eventContract = eventNft.contract;
                const eventTokenId = eventNft.identifier;
                const eventPrice = parseFloat(event.payment?.quantity || 0) / 1e18;
                const eventMaker = event.maker?.address?.toLowerCase();

                // Verificar se é de outra wallet
                if (db.wallets.some(w => w.toLowerCase() === eventMaker)) {
                    continue;
                }

                for (const nft of db.nfts) {
                    // 1. Verificar undercut por NFT específica (contract + tokenId)
                    const isSameNft = nft.contract === eventContract && nft.tokenId === eventTokenId;

                    // 2. Verificar undercut por nome (NFTs genéricas)
                    const nftBaseName = nft.name?.split('#')[0]?.trim() || '';
                    const eventBaseName = eventName.split('#')[0]?.trim() || '';
                    const isGenericUndercut = nftBaseName && eventBaseName && nftBaseName === eventBaseName;

                    if ((isSameNft || isGenericUndercut) && nft.myListingPrice && eventPrice < nft.myListingPrice && eventPrice > 0) {
                        nft.isUndercut = true;
                        nft.listedPrice = eventPrice;

                        // Gerar alerta
                        await createUndercutAlert(nft, eventPrice);
                    }
                }
            }
        } catch (error) {
            console.error(`Erro ao monitorar eventos de ${collection}:`, error.message);
        }
    }
}

// Criar alerta de undercut
async function createUndercutAlert(nft, newPrice) {
    const alert = {
        type: 'danger',
        title: `Undercut: ${nft.name}`,
        details: `Novo preço: ${newPrice.toFixed(4)} ETH (seu preço: ${nft.myListingPrice?.toFixed(4) || 'N/A'} ETH)`,
        timestamp: new Date().toISOString(),
        nftId: nft.id
    };

    // Verificar se já existe alerta recente para este NFT
    const recentAlert = db.alerts.find(a =>
        a.nftId === nft.id &&
        Date.now() - new Date(a.timestamp).getTime() < 60000
    );

    if (!recentAlert) {
        db.alerts.unshift(alert);
        if (db.alerts.length > 50) db.alerts.pop();

        // Enviar alerta Discord
        await sendDiscordAlert(nft, alert);
    }
}

// Enviar alerta Discord (usa webhook do admin)
async function sendDiscordAlert(nft, alert) {
    const data = loadProfiles();
    const profile = data.profiles[data.activeProfile];
    const settings = profile?.settings || {};

    // Verificar se alertas Discord estão ativados no perfil
    if (!settings.alertDiscord) return;

    // Buscar webhook do admin para este perfil
    const webhooks = loadWebhooks();
    const webhookUrl = webhooks[data.activeProfile];

    if (!webhookUrl) {
        console.log(`Sem webhook configurado para perfil: ${data.activeProfile}`);
        return;
    }

    const isSpecialNft = settings.discordNfts?.includes(nft.id);

    const embed = {
        title: isSpecialNft ? `🚨 NFT MONITORADA - Undercut Detectado!` : `⚠️ Undercut Detectado`,
        description: alert.details,
        color: isSpecialNft ? 15158332 : 16776960,
        fields: [
            { name: 'NFT', value: nft.name || `#${nft.tokenId}`, inline: true },
            { name: 'Novo Preço', value: `${nft.listedPrice?.toFixed(4) || 'N/A'} ETH`, inline: true },
            { name: 'Seu Preço', value: `${nft.myListingPrice?.toFixed(4) || 'N/A'} ETH`, inline: true }
        ],
        url: `https://opensea.io/assets/ethereum/${nft.contract}/${nft.tokenId}`,
        timestamp: new Date().toISOString()
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`Alerta Discord enviado para perfil: ${data.activeProfile}`);
    } catch (error) {
        console.error('Erro ao enviar alerta Discord:', error.message);
    }
}

// API Endpoints - NFTs
app.get('/api/nfts', (req, res) => {
    applyPendingNftData();
    res.json({ nfts: db.nfts });
});

app.post('/api/nfts/refresh', async (req, res) => {
    await loadNFTsFromWallets();
    applyPendingNftData();
    res.json({ nfts: db.nfts });
});

app.post('/api/nfts/:id/hide', (req, res) => {
    const { id } = req.params;
    const { hidden } = req.body;

    const data = loadProfiles();
    if (!data.activeProfile) {
        return res.status(400).json({ error: 'Nenhum perfil ativo' });
    }

    const profile = data.profiles[data.activeProfile];
    if (!profile.hiddenNfts) profile.hiddenNfts = [];

    if (hidden) {
        if (!profile.hiddenNfts.includes(id)) {
            profile.hiddenNfts.push(id);
        }
    } else {
        profile.hiddenNfts = profile.hiddenNfts.filter(h => h !== id);
    }

    // Atualizar NFT local
    const nft = db.nfts.find(n => n.id === id);
    if (nft) nft.hidden = hidden;

    db.pendingHiddenNfts = profile.hiddenNfts;
    profile.lastUpdated = new Date().toISOString();
    saveProfiles(data);

    res.json({ success: true });
});

app.post('/api/nfts/:id/purchase-price', (req, res) => {
    const { id } = req.params;
    const { purchasePrice } = req.body;

    const data = loadProfiles();
    if (!data.activeProfile) {
        return res.status(400).json({ error: 'Nenhum perfil ativo' });
    }

    const profile = data.profiles[data.activeProfile];
    if (!profile.purchasePrices) profile.purchasePrices = {};

    if (purchasePrice) {
        profile.purchasePrices[id] = purchasePrice;
    } else {
        delete profile.purchasePrices[id];
    }

    // Atualizar NFT local
    const nft = db.nfts.find(n => n.id === id);
    if (nft) nft.purchasePrice = purchasePrice;

    db.pendingPurchasePrices = profile.purchasePrices;
    profile.lastUpdated = new Date().toISOString();
    saveProfiles(data);

    res.json({ success: true });
});

// ===========================================
// ALERTAS
// ===========================================
app.get('/api/alerts', (req, res) => {
    res.json({ alerts: db.alerts });
});

app.delete('/api/alerts', (req, res) => {
    db.alerts = [];
    res.json({ success: true });
});

// ===========================================
// SETTINGS
// ===========================================
app.post('/api/settings', (req, res) => {
    const settings = req.body;

    const data = loadProfiles();
    if (!data.activeProfile) {
        return res.status(400).json({ error: 'Nenhum perfil ativo' });
    }

    data.profiles[data.activeProfile].settings = settings;
    data.profiles[data.activeProfile].lastUpdated = new Date().toISOString();
    saveProfiles(data);

    res.json({ success: true });
});

// ===========================================
// CRON JOB - Atualização automática
// ===========================================
cron.schedule('*/1 * * * *', async () => {
    if (db.wallets.length > 0) {
        console.log('Atualizando NFTs...');
        await loadNFTsFromWallets();
        console.log(`NFTs atualizados: ${db.nfts.length}`);
    }
});

// ===========================================
// INICIALIZAÇÃO
// ===========================================
async function init() {
    const data = loadProfiles();

    if (data.activeProfile && data.profiles[data.activeProfile]) {
        const profile = data.profiles[data.activeProfile];
        db.wallets = profile.wallets || [];
        db.pendingPurchasePrices = profile.purchasePrices || {};
        db.pendingHiddenNfts = profile.hiddenNfts || [];

        if (db.wallets.length > 0) {
            console.log('Carregando NFTs do perfil ativo...');
            await loadNFTsFromWallets();
        }
    }

    app.listen(PORT, () => {
        console.log(`NFT Monitor rodando em http://localhost:${PORT}`);
    });
}

init();
