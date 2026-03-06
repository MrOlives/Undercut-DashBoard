// ===========================================
// NFT UNDERCUT MONITOR - FRONTEND
// ===========================================

// API URL - Detecta automaticamente se está em produção ou desenvolvimento
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : window.location.origin;

// Estado global
let state = {
    activeProfile: null,
    wallets: [],
    nfts: [],
    alerts: [],
    sortOrder: null,
    settings: {
        alertDashboard: true,
        alertDiscord: false,
        discordWebhook: '',
        discordNfts: [], // Array de IDs das NFTs selecionadas para alerta especial
        checkInterval: 5
    }
};

// ===========================================
// INICIALIZAÇÃO
// ===========================================
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    loadSortOrder();
    await loadProfiles(); // Carregar perfis primeiro
    setupEventListeners();
    setupProfileEventListeners();
    startAutoRefresh();
});

// ===========================================
// PERFIS
// ===========================================
async function loadProfiles() {
    try {
        const response = await fetch(`${API_URL}/api/profiles`);
        const data = await response.json();

        renderProfileSelect(data.profiles, data.activeProfile);

        if (data.activeProfile) {
            state.activeProfile = data.activeProfile;
            await loadWallets();
            await loadAlerts();
        } else {
            // Sem perfil ativo - mostrar mensagem
            document.getElementById('nfts-grid').innerHTML = `
                <div class="loading-placeholder">
                    <p>Crie ou selecione um perfil para começar</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar perfis:', error);
    }
}

function renderProfileSelect(profiles, activeProfile) {
    const select = document.getElementById('profile-select');
    select.innerHTML = '<option value="">Selecione um perfil...</option>';

    profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.name;
        option.textContent = `${profile.name} (${profile.walletCount} wallets)`;
        if (profile.name === activeProfile) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function switchProfile(profileName) {
    if (!profileName) return;

    try {
        const response = await fetch(`${API_URL}/api/profiles/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: profileName })
        });

        if (response.ok) {
            state.activeProfile = profileName;
            await loadWallets();
            await loadAlerts();
            showNotification(`Perfil "${profileName}" carregado!`, 'success');
        } else {
            const error = await response.json();
            showNotification(error.error || 'Erro ao trocar perfil', 'error');
        }
    } catch (error) {
        showNotification('Erro ao trocar perfil', 'error');
    }
}

async function createProfile(profileName) {
    if (!profileName || profileName.trim().length === 0) {
        showNotification('Digite um nome para o perfil', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/profiles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: profileName.trim() })
        });

        if (response.ok) {
            showNotification(`Perfil "${profileName}" criado!`, 'success');
            // Trocar para o novo perfil
            await switchProfile(profileName.trim());
            // Recarregar lista de perfis
            const profilesResponse = await fetch(`${API_URL}/api/profiles`);
            const data = await profilesResponse.json();
            renderProfileSelect(data.profiles, data.activeProfile);
        } else {
            const error = await response.json();
            showNotification(error.error || 'Erro ao criar perfil', 'error');
        }
    } catch (error) {
        showNotification('Erro ao criar perfil', 'error');
    }
}

function setupProfileEventListeners() {
    // Selecionar perfil
    document.getElementById('profile-select').addEventListener('change', (e) => {
        const profileName = e.target.value;
        // Mostrar/esconder botão de deletar
        document.getElementById('delete-profile-btn').style.display = profileName ? 'inline-block' : 'none';
        switchProfile(profileName);
    });

    // Mostrar formulário de criar perfil
    document.getElementById('create-profile-btn').addEventListener('click', () => {
        document.getElementById('create-profile-form').style.display = 'flex';
        document.getElementById('new-profile-name').focus();
    });

    // Confirmar criação
    document.getElementById('confirm-create-profile').addEventListener('click', () => {
        const name = document.getElementById('new-profile-name').value;
        createProfile(name);
        document.getElementById('create-profile-form').style.display = 'none';
        document.getElementById('new-profile-name').value = '';
    });

    // Cancelar criação
    document.getElementById('cancel-create-profile').addEventListener('click', () => {
        document.getElementById('create-profile-form').style.display = 'none';
        document.getElementById('new-profile-name').value = '';
    });

    // Enter no campo de nome
    document.getElementById('new-profile-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('confirm-create-profile').click();
        }
    });

    // Deletar perfil
    document.getElementById('delete-profile-btn').addEventListener('click', async () => {
        const profileName = document.getElementById('profile-select').value;
        if (!profileName) return;

        if (!confirm(`Tem certeza que deseja deletar o perfil "${profileName}"?\n\nTodas as wallets e dados serão perdidos.`)) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/profiles/${encodeURIComponent(profileName)}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showNotification(`Perfil "${profileName}" deletado`, 'success');
                state.activeProfile = null;
                state.wallets = [];
                state.nfts = [];

                // Recarregar lista de perfis
                const profilesResponse = await fetch(`${API_URL}/api/profiles`);
                const data = await profilesResponse.json();
                renderProfileSelect(data.profiles, null);

                // Limpar UI
                renderWallets();
                document.getElementById('nfts-grid').innerHTML = `
                    <div class="loading-placeholder">
                        <p>Selecione ou crie um perfil para começar</p>
                    </div>
                `;
                document.getElementById('delete-profile-btn').style.display = 'none';
            } else {
                showNotification('Erro ao deletar perfil', 'error');
            }
        } catch (error) {
            showNotification('Erro ao deletar perfil', 'error');
        }
    });
}

// Carregar ordenacao salva
function loadSortOrder() {
    const savedSort = localStorage.getItem('nft-sort-order');
    if (savedSort) {
        state.sortOrder = savedSort;
    }
}

// ===========================================
// EVENT LISTENERS
// ===========================================
function setupEventListeners() {
    // Adicionar carteira
    document.getElementById('add-wallet').addEventListener('click', addWallet);
    document.getElementById('wallet-address').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addWallet();
    });

    // Atualizar NFTs
    document.getElementById('refresh-nfts').addEventListener('click', refreshNFTs);

    // Filtro de ordenação
    document.getElementById('filter-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('filter-menu').classList.toggle('show');
        document.getElementById('size-menu').classList.remove('show');
    });

    // Botão de tamanho
    document.getElementById('size-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('size-menu').classList.toggle('show');
        document.getElementById('filter-menu').classList.remove('show');
    });

    // Fechar dropdowns ao clicar fora
    document.addEventListener('click', () => {
        document.getElementById('filter-menu').classList.remove('show');
        document.getElementById('size-menu').classList.remove('show');
    });

    // Opções de ordenação
    document.querySelectorAll('#filter-menu .dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const sortType = e.target.dataset.sort;
            sortNFTs(sortType);
            document.getElementById('filter-menu').classList.remove('show');
        });
    });

    // Opções de tamanho
    document.querySelectorAll('#size-menu .dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const sizeType = e.target.dataset.size;
            changeGridSize(sizeType);
            document.getElementById('size-menu').classList.remove('show');
        });
    });

    // Limpar alertas
    document.getElementById('clear-alerts').addEventListener('click', clearAlerts);

    // Salvar configurações
    document.getElementById('save-settings').addEventListener('click', saveSettings);

    // Discord checkbox - mostrar/esconder lista de NFTs
    document.getElementById('alert-discord').addEventListener('change', updateDiscordNftsSection);

    // Modal
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('nft-modal').addEventListener('click', (e) => {
        if (e.target.id === 'nft-modal') closeModal();
    });
}

// ===========================================
// CARTEIRAS
// ===========================================
async function loadWallets() {
    if (!state.activeProfile) {
        document.getElementById('wallets-list').innerHTML = '<p class="no-wallets" style="color: var(--text-muted);">Selecione um perfil primeiro</p>';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/wallets`);
        const data = await response.json();
        state.wallets = data.wallets || [];
        renderWallets();

        if (state.wallets.length > 0) {
            await refreshNFTs();
        }
    } catch (error) {
        console.error('Erro ao carregar carteiras:', error);
    }
}

async function addWallet() {
    if (!state.activeProfile) {
        showNotification('Selecione ou crie um perfil primeiro', 'error');
        return;
    }

    const input = document.getElementById('wallet-address');
    const button = document.getElementById('add-wallet');
    const address = input.value.trim();

    if (!address) return;

    // Validar formato Ethereum
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        showNotification('Endereço inválido. Use formato 0x...', 'error');
        return;
    }

    if (state.wallets.includes(address.toLowerCase())) {
        showNotification('Esta carteira já foi adicionada', 'error');
        return;
    }

    // Mostrar loading
    button.disabled = true;
    button.textContent = '...';

    try {
        const response = await fetch(`${API_URL}/api/wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: address.toLowerCase() })
        });

        if (response.ok) {
            state.wallets.push(address.toLowerCase());
            renderWallets();
            input.value = '';
            showNotification('Carteira adicionada!', 'success');
            await refreshNFTs();
        }
    } catch (error) {
        showNotification('Erro ao adicionar carteira', 'error');
    } finally {
        // Resetar botão
        button.disabled = false;
        button.textContent = 'Add';
    }
}

async function removeWallet(address) {
    try {
        await fetch(`${API_URL}/api/wallets/${address}`, { method: 'DELETE' });
        state.wallets = state.wallets.filter(w => w !== address);
        renderWallets();
        await refreshNFTs();
        showNotification('Carteira removida', 'success');
    } catch (error) {
        showNotification('Erro ao remover carteira', 'error');
    }
}

function renderWallets() {
    const container = document.getElementById('wallets-list');

    if (state.wallets.length === 0) {
        container.innerHTML = '<p class="no-wallets" style="color: var(--text-muted);">Nenhuma carteira adicionada</p>';
        return;
    }

    container.innerHTML = state.wallets.map(wallet => `
        <div class="wallet-tag">
            <span>💼</span>
            <span class="address">${wallet.slice(0, 6)}...${wallet.slice(-4)}</span>
            <button class="remove-btn" onclick="removeWallet('${wallet}')">×</button>
        </div>
    `).join('');
}

// ===========================================
// NFTs
// ===========================================
async function refreshNFTs() {
    if (state.wallets.length === 0) {
        document.getElementById('nfts-grid').innerHTML = `
            <div class="loading-placeholder">
                <p>Adicione uma carteira para ver seus NFTs</p>
            </div>
        `;
        return;
    }

    document.getElementById('nfts-grid').innerHTML = `
        <div class="loading-placeholder">
            <div class="loader"></div>
            <p style="margin-top: 15px;">Buscando seus NFTs...</p>
        </div>
    `;

    try {
        const response = await fetch(`${API_URL}/api/nfts`);
        const data = await response.json();

        state.nfts = data.nfts || [];

        // Re-aplicar filtro se houver um selecionado
        if (state.sortOrder) {
            applySort(state.sortOrder);
        }

        renderNFTs();
        updateStats();
        updateLastRefresh();

    } catch (error) {
        console.error('Erro ao buscar NFTs:', error);
        document.getElementById('nfts-grid').innerHTML = `
            <div class="loading-placeholder">
                <p style="color: var(--danger);">Erro ao carregar NFTs. Tente novamente.</p>
            </div>
        `;
    }
}

// Aplicar ordenacao (reutilizavel)
function applySort(sortType) {
    if (sortType === 'price-asc') {
        state.nfts.sort((a, b) => (a.listedPrice || 0) - (b.listedPrice || 0));
    } else if (sortType === 'price-desc') {
        state.nfts.sort((a, b) => (b.listedPrice || 0) - (a.listedPrice || 0));
    } else if (sortType === 'bid-asc') {
        state.nfts.sort((a, b) => (a.bidPrice || a.topBid || 0) - (b.bidPrice || b.topBid || 0));
    } else if (sortType === 'bid-desc') {
        state.nfts.sort((a, b) => (b.bidPrice || b.topBid || 0) - (a.bidPrice || a.topBid || 0));
    }
}

// Ordenar NFTs (chamado pelo usuario)
function sortNFTs(sortType) {
    state.sortOrder = sortType;
    localStorage.setItem('nft-sort-order', sortType); // Salvar preferencia
    applySort(sortType);
    renderNFTs();
}

// Mudar tamanho do grid
function changeGridSize(sizeType) {
    const grid = document.getElementById('nfts-grid');

    // Remover todas as classes de tamanho
    grid.classList.remove('size-small', 'size-medium', 'size-large', 'size-list');

    // Adicionar nova classe de tamanho
    if (sizeType !== 'large') {
        grid.classList.add(`size-${sizeType}`);
    }
    // large é o padrão (sem classe extra)
}

function renderNFTs() {
    const container = document.getElementById('nfts-grid');

    if (state.nfts.length === 0) {
        container.innerHTML = `
            <div class="loading-placeholder">
                <p>Nenhum NFT encontrado nas carteiras</p>
            </div>
        `;
        return;
    }

    // Separate visible and hidden NFTs
    const visibleNfts = state.nfts.filter(nft => !nft.hidden);
    const hiddenNfts = state.nfts.filter(nft => nft.hidden);

    // Render visible NFTs
    container.innerHTML = visibleNfts.map(nft => {
        // UNDERCUT = o menor listing NAO eh do usuario
        const cardClass = nft.isUndercut ? 'undercut' : 'safe';
        const listedDisplay = nft.listedPrice ? formatPrice(nft.listedPrice) + ' ETH' : 'N/A';
        const bidDisplay = nft.bidPrice ? formatPrice(nft.bidPrice) + ' ETH' : 'N/A';

        // Cor do bid baseada no preço de compra
        let bidColor = 'var(--primary)'; // verde padrão
        if (nft.purchasePrice && nft.bidPrice) {
            bidColor = nft.bidPrice >= nft.purchasePrice ? 'var(--success)' : 'var(--danger)';
        }

        return `
            <div class="nft-card ${cardClass}" onclick="openNFTModal('${nft.id}')">
                <button class="hide-btn" onclick="event.stopPropagation(); hideNFT('${nft.id}')">👁️ Hide</button>
                <img src="${nft.image || 'https://via.placeholder.com/280x200?text=NFT'}" alt="${nft.name}" class="nft-image" onerror="this.src='https://via.placeholder.com/280x200?text=NFT'">
                <div class="nft-info">
                    <div class="nft-collection">${nft.collectionName || 'Collection'}</div>
                    <div class="nft-name">${nft.name || `#${nft.tokenId}`}</div>
                    <div class="nft-prices">
                        <div class="nft-floor">
                            <div class="nft-floor-label">Listed</div>
                            <div class="nft-floor-value">${listedDisplay}</div>
                        </div>
                        <div class="nft-bid">
                            <div class="nft-bid-label">Top Bid</div>
                            <div class="nft-bid-value" style="color: ${bidColor};">${bidDisplay}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Update hidden count in header
    const hiddenCountEl = document.getElementById('hidden-count');
    if (hiddenNfts.length > 0) {
        hiddenCountEl.textContent = `(${hiddenNfts.length} hidden)`;
    } else {
        hiddenCountEl.textContent = '';
    }

    // Render hidden NFTs section
    renderHiddenNFTs(hiddenNfts);
}

function renderHiddenNFTs(hiddenNfts) {
    const section = document.getElementById('hidden-nfts-section');
    const grid = document.getElementById('hidden-grid');
    const totalEl = document.getElementById('hidden-total');

    if (hiddenNfts.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    totalEl.textContent = hiddenNfts.length;

    grid.innerHTML = hiddenNfts.map(nft => `
        <div class="hidden-nft-item">
            <img src="${nft.image || 'https://via.placeholder.com/32x32?text=NFT'}" alt="${nft.name}" onerror="this.src='https://via.placeholder.com/32x32?text=NFT'">
            <span class="nft-name" title="${nft.name}">${nft.name || `#${nft.tokenId}`}</span>
            <button class="unhide-btn" onclick="unhideNFT('${nft.id}')">Show</button>
        </div>
    `).join('');
}

function toggleHiddenSection() {
    const section = document.getElementById('hidden-nfts-section');
    section.classList.toggle('collapsed');
}

async function hideNFT(nftId) {
    try {
        const response = await fetch(`${API_URL}/api/nfts/${nftId}/hide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden: true })
        });

        if (response.ok) {
            // Update local state
            const nft = state.nfts.find(n => n.id === nftId);
            if (nft) nft.hidden = true;

            renderNFTs();
            updateStats();
            showNotification('NFT hidden', 'success');
        }
    } catch (error) {
        showNotification('Erro ao esconder NFT', 'error');
    }
}

async function unhideNFT(nftId) {
    try {
        const response = await fetch(`${API_URL}/api/nfts/${nftId}/hide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden: false })
        });

        if (response.ok) {
            // Update local state
            const nft = state.nfts.find(n => n.id === nftId);
            if (nft) nft.hidden = false;

            renderNFTs();
            updateStats();
            showNotification('NFT restored', 'success');
        }
    } catch (error) {
        showNotification('Erro ao restaurar NFT', 'error');
    }
}

function formatPrice(price) {
    // Arredonda para 3 casas e remove zeros à direita
    const rounded = parseFloat(price.toFixed(3));
    const str = rounded.toString();
    // Se for menor que 1, mostra como .XXX em vez de 0.XXX
    return rounded < 1 ? str.replace('0.', '.') : str;
}

function updateStats() {
    // Only count visible NFTs
    const visibleNfts = state.nfts.filter(nft => !nft.hidden);
    const totalNfts = visibleNfts.length;
    document.getElementById('total-nfts').textContent = totalNfts;

    // Atualizar label: NFT's para plural, NFT para singular
    const nftsLabel = document.getElementById('nfts-label');
    if (nftsLabel) {
        nftsLabel.textContent = totalNfts === 1 ? 'NFT' : "NFT's";
    }

    const totalValue = visibleNfts.reduce((sum, nft) => sum + (nft.listedPrice || 0), 0);
    document.getElementById('total-value').textContent = `${formatPrice(totalValue)} ETH`;

    // Total de bids
    const totalBids = visibleNfts.reduce((sum, nft) => sum + (nft.bidPrice || nft.topBid || 0), 0);
    document.getElementById('total-bids').textContent = `${formatPrice(totalBids)} ETH`;

    // Undercuts = NFTs onde isUndercut = true (only visible)
    const undercutsToday = visibleNfts.filter(nft => nft.isUndercut).length;
    document.getElementById('total-undercuts').textContent = undercutsToday;
}

function updateLastRefresh() {
    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ===========================================
// MODAL
// ===========================================
function openNFTModal(nftId) {
    const nft = state.nfts.find(n => n.id === nftId);
    if (!nft) return;

    const modal = document.getElementById('nft-modal');
    const modalBody = document.getElementById('modal-body');

    // Calcular diferença de undercut (se houver)
    let diffDisplay = 'N/A';
    if (nft.isUndercut && nft.myListingPrice && nft.listedPrice) {
        const diff = nft.myListingPrice - nft.listedPrice;
        diffDisplay = `-${diff.toFixed(4)} ETH`;
    }

    // Calcular P/L se tiver custo e preco de listing
    let plDisplay = '';
    let plColor = 'var(--text-muted)';
    if (nft.purchasePrice && nft.myListingPrice) {
        const pl = nft.myListingPrice - nft.purchasePrice;
        const plPercent = ((pl / nft.purchasePrice) * 100).toFixed(1);
        if (pl >= 0) {
            plDisplay = `+${pl.toFixed(4)} ETH (+${plPercent}%)`;
            plColor = 'var(--success)';
        } else {
            plDisplay = `${pl.toFixed(4)} ETH (${plPercent}%)`;
            plColor = 'var(--danger)';
        }
    }

    modalBody.innerHTML = `
        <a href="https://opensea.io/assets/ethereum/${nft.contract}/${nft.tokenId}" target="_blank" class="modal-nft-link">
            <img src="${nft.image || 'https://via.placeholder.com/600x300?text=NFT'}" alt="${nft.name}" class="modal-nft-image" onerror="this.src='https://via.placeholder.com/600x300?text=NFT'">
        </a>
        <h2 class="modal-nft-name">${nft.name || `#${nft.tokenId}`}</h2>
        <p class="modal-nft-collection">${nft.collectionName || 'Collection'}</p>

        <div class="modal-stats">
            <div class="modal-stat">
                <div class="modal-stat-label">Listed</div>
                <div class="modal-stat-value" style="color: ${nft.isUndercut ? 'var(--danger)' : 'var(--success)'};">${nft.listedPrice ? `${nft.listedPrice} ETH` : 'N/A'}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Seu Preço</div>
                <div class="modal-stat-value">${nft.myListingPrice ? `${nft.myListingPrice} ETH` : 'Não listado'}</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">Preço de Compra</div>
                <div class="modal-stat-value">
                    <input type="number" id="purchase-price-input" step="0.0001" placeholder="0.00" value="${nft.purchasePrice || ''}"
                           onchange="savePurchasePrice('${nft.id}', this.value)"
                           class="purchase-price-input">
                    <span class="purchase-price-suffix">ETH</span>
                </div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-label">P/L ${nft.myListingPrice ? '(se vender)' : ''}</div>
                <div class="modal-stat-value" style="color: ${plColor};">${plDisplay || '—'}</div>
            </div>
        </div>

        <div class="modal-alert-settings">
            <h4>🔔 Alerta Discord para este NFT</h4>
            <div class="modal-alert-toggle">
                <label class="checkbox-label">
                    <input type="checkbox" ${state.settings.discordNfts?.includes(nft.id) ? 'checked' : ''} onchange="toggleDiscordNft('${nft.id}', this.checked); renderDiscordNftsList();">
                    <span>Receber alerta no Discord</span>
                </label>
            </div>
            <small style="color: var(--text-muted); margin-top: 8px; display: block;">
                Ative para receber mensagem no Discord quando houver undercut nesta NFT
            </small>
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px;">
            <a href="https://opensea.io/assets/ethereum/${nft.contract}/${nft.tokenId}" target="_blank" class="btn btn-primary" style="text-decoration: none;">
                Ver no OpenSea
            </a>
            ${nft.blurUrl ? `<a href="${nft.blurUrl}" target="_blank" class="btn btn-secondary" style="text-decoration: none;">Ver no Blur</a>` : ''}
        </div>
    `;

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('nft-modal').classList.remove('active');
}

async function toggleNFTAlert(nftId, type, enabled) {
    try {
        await fetch(`${API_URL}/api/nfts/${nftId}/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, enabled })
        });

        // Atualizar estado local
        const nft = state.nfts.find(n => n.id === nftId);
        if (nft) {
            nft.alerts = nft.alerts || {};
            nft.alerts[type] = enabled;
        }

        showNotification(`Alerta ${enabled ? 'ativado' : 'desativado'}`, 'success');
    } catch (error) {
        showNotification('Erro ao atualizar alerta', 'error');
    }
}

async function savePurchasePrice(nftId, value) {
    const purchasePrice = parseFloat(value) || null;

    try {
        await fetch(`${API_URL}/api/nfts/${nftId}/purchase-price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchasePrice })
        });

        // Atualizar estado local
        const nft = state.nfts.find(n => n.id === nftId);
        if (nft) {
            nft.purchasePrice = purchasePrice;
        }

        showNotification('Preço de compra salvo!', 'success');

        // Reabrir modal para atualizar P/L
        openNFTModal(nftId);
    } catch (error) {
        showNotification('Erro ao salvar preço', 'error');
    }
}

// ===========================================
// ALERTAS
// ===========================================
async function loadAlerts() {
    try {
        const response = await fetch(`${API_URL}/api/alerts`);
        const data = await response.json();
        state.alerts = data.alerts || [];
        renderAlerts();
    } catch (error) {
        console.error('Erro ao carregar alertas:', error);
    }
}

function renderAlerts() {
    const container = document.getElementById('alerts-list');
    const liveContainer = document.getElementById('live-alerts');

    if (state.alerts.length === 0) {
        const noAlertsHtml = '<div class="no-alerts">No undercuts detected</div>';
        if (container) container.innerHTML = noAlertsHtml;
        if (liveContainer) liveContainer.innerHTML = noAlertsHtml;
        return;
    }

    const alertsHtml = state.alerts.map(alert => `
        <div class="alert-item ${alert.type}">
            <div class="alert-icon">${alert.type === 'danger' ? '🚨' : alert.type === 'warning' ? '⚠️' : 'ℹ️'}</div>
            <div class="alert-content">
                <div class="alert-title">${alert.title}</div>
                <div class="alert-details">${alert.details}</div>
            </div>
            <div class="alert-time">${formatTime(alert.timestamp)}</div>
        </div>
    `).join('');

    if (container) container.innerHTML = alertsHtml;
    if (liveContainer) liveContainer.innerHTML = alertsHtml;
}

async function clearAlerts() {
    try {
        await fetch(`${API_URL}/api/alerts`, { method: 'DELETE' });
        state.alerts = [];
        renderAlerts();
        showNotification('Alertas limpos', 'success');
    } catch (error) {
        showNotification('Erro ao limpar alertas', 'error');
    }
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ===========================================
// CONFIGURAÇÕES
// ===========================================
function loadSettings() {
    const saved = localStorage.getItem('nft-monitor-settings');
    if (saved) {
        state.settings = { ...state.settings, ...JSON.parse(saved) };
    }

    // Aplicar ao DOM
    document.getElementById('alert-dashboard').checked = state.settings.alertDashboard;
    document.getElementById('alert-discord').checked = state.settings.alertDiscord;
    document.getElementById('check-interval').value = state.settings.checkInterval || 5;

    // Mostrar/esconder seção de NFTs do Discord
    updateDiscordNftsSection();
}

async function saveSettings() {
    state.settings = {
        alertDashboard: document.getElementById('alert-dashboard').checked,
        alertDiscord: document.getElementById('alert-discord').checked,
        discordWebhook: '', // Gerenciado pelo admin
        discordNfts: state.settings.discordNfts || [],
        checkInterval: parseInt(document.getElementById('check-interval').value) || 5
    };

    // Salvar localmente
    localStorage.setItem('nft-monitor-settings', JSON.stringify(state.settings));

    // Enviar para servidor
    try {
        await fetch(`${API_URL}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        showNotification('Configurações salvas!', 'success');
    } catch (error) {
        showNotification('Erro ao salvar configurações', 'error');
    }
}

// ===========================================
// WHATSAPP NFT SELECTION
// ===========================================
// ===========================================
// DISCORD NFT SELECTION
// ===========================================
function updateDiscordNftsSection() {
    const section = document.getElementById('discord-nfts-section');
    const isEnabled = document.getElementById('alert-discord').checked;

    if (isEnabled) {
        section.style.display = 'block';
        renderDiscordNftsList();
    } else {
        section.style.display = 'none';
    }
}

function renderDiscordNftsList() {
    const container = document.getElementById('discord-nfts-list');
    // Só mostrar NFTs não escondidas
    const visibleNfts = state.nfts.filter(nft => !nft.hidden);

    if (visibleNfts.length === 0) {
        container.innerHTML = '<p class="no-nfts-message">Adicione NFTs ao dashboard primeiro</p>';
        return;
    }

    container.innerHTML = visibleNfts.map(nft => {
        const isSelected = state.settings.discordNfts?.includes(nft.id);
        return `
            <label class="discord-nft-item">
                <input type="checkbox"
                       ${isSelected ? 'checked' : ''}
                       onchange="toggleDiscordNft('${nft.id}', this.checked)">
                <span class="discord-nft-name">${nft.name || `#${nft.tokenId}`}</span>
                <span class="discord-nft-price">${nft.myListingPrice ? nft.myListingPrice.toFixed(2) + ' ETH' : 'N/A'}</span>
            </label>
        `;
    }).join('');
}

function toggleDiscordNft(nftId, enabled) {
    if (!state.settings.discordNfts) {
        state.settings.discordNfts = [];
    }

    if (enabled) {
        if (!state.settings.discordNfts.includes(nftId)) {
            state.settings.discordNfts.push(nftId);
        }
    } else {
        state.settings.discordNfts = state.settings.discordNfts.filter(id => id !== nftId);
    }

    // Salvar automaticamente
    localStorage.setItem('nft-monitor-settings', JSON.stringify(state.settings));
}

// ===========================================
// AUTO REFRESH
// ===========================================
let refreshInterval;

function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);

    // Atualizar a cada 20 segundos para dados em tempo real
    const interval = 20 * 1000;
    refreshInterval = setInterval(async () => {
        if (state.wallets.length > 0) {
            await refreshNFTs();
            await loadAlerts();
        }
    }, interval);
}

// ===========================================
// NOTIFICAÇÕES
// ===========================================
function showNotification(message, type = 'info') {
    // Criar elemento de notificação
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 8px;
        background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--primary)'};
        color: white;
        font-weight: 500;
        z-index: 2000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Remover após 3 segundos
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Adicionar estilos de animação
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// ===========================================
// ADMIN - Gerenciamento de Webhooks
// ===========================================
let adminLoggedIn = false;

function initAdminEvents() {
    // Botão de admin
    document.getElementById('admin-btn').addEventListener('click', () => {
        document.getElementById('admin-modal').style.display = 'flex';
        if (adminLoggedIn) {
            loadAdminProfiles();
        }
    });

    // Fechar modal
    document.getElementById('admin-modal-close').addEventListener('click', closeAdminModal);
    document.getElementById('admin-modal').addEventListener('click', (e) => {
        if (e.target.id === 'admin-modal') closeAdminModal();
    });

    // Login
    document.getElementById('admin-login-btn').addEventListener('click', adminLogin);
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') adminLogin();
    });

    // Refresh
    document.getElementById('admin-refresh').addEventListener('click', loadAdminProfiles);
}

function closeAdminModal() {
    document.getElementById('admin-modal').style.display = 'none';
}

async function adminLogin() {
    const password = document.getElementById('admin-password').value;

    try {
        const response = await fetch(`${API_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            adminLoggedIn = true;
            document.getElementById('admin-login').style.display = 'none';
            document.getElementById('admin-panel').style.display = 'block';
            document.getElementById('admin-login-error').style.display = 'none';
            loadAdminProfiles();
        } else {
            document.getElementById('admin-login-error').style.display = 'block';
        }
    } catch (error) {
        console.error('Erro no login admin:', error);
    }
}

async function loadAdminProfiles() {
    try {
        const response = await fetch(`${API_URL}/api/admin/profiles`);
        const data = await response.json();

        const container = document.getElementById('admin-profiles-list');
        container.innerHTML = data.profiles.map(profile => `
            <div class="admin-profile-item" style="background: var(--card-bg); padding: 15px; border-radius: 8px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div>
                        <strong style="font-size: 16px;">${profile.name}</strong>
                        <span style="color: var(--text-muted); margin-left: 10px;">${profile.walletCount} carteira(s)</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${profile.hasWebhook
                            ? '<span style="color: var(--success);">✅ Webhook configurado</span>'
                            : '<span style="color: var(--danger);">❌ Sem webhook</span>'}
                        ${profile.alertDiscord
                            ? '<span style="color: var(--accent);">🔔 Alertas ON</span>'
                            : '<span style="color: var(--text-muted);">🔕 Alertas OFF</span>'}
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <input
                        type="text"
                        id="webhook-${profile.name}"
                        class="setting-input"
                        placeholder="Cole o webhook do Discord aqui..."
                        style="flex: 1; font-size: 12px;"
                    >
                    <button class="btn btn-primary" onclick="saveWebhook('${profile.name}')" style="font-size: 12px;">Salvar</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar perfis admin:', error);
    }
}

async function saveWebhook(profileName) {
    const webhookInput = document.getElementById(`webhook-${profileName}`);
    const webhook = webhookInput.value.trim();

    try {
        const response = await fetch(`${API_URL}/api/admin/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileName, webhook })
        });

        if (response.ok) {
            showNotification(`Webhook salvo para ${profileName}`, 'success');
            loadAdminProfiles();
        } else {
            showNotification('Erro ao salvar webhook', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar webhook:', error);
        showNotification('Erro ao salvar webhook', 'error');
    }
}

// Inicializar admin events
initAdminEvents();
