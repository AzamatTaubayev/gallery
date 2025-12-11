// app.js

// Global variables
let provider;
let signer;
let contract;
let account;
let allCertificates = [];
let filteredCertificates = [];
let viewMode = 'all'; // 'all' or 'my'

// Initialize app when page loads
window.addEventListener('load', async () => {
    // IMPORTANT: Ensure Ethers v6 is loaded in your HTML:
    // <script src="https://cdn.jsdelivr.net/npm/ethers@6.16.0/lib.commonjs/index.min.js"></script>
    
    // Check if MetaMask is installed
    if (typeof window.ethereum !== 'undefined') {
        console.log('MetaMask is installed!');
    } else {
        alert('Please install MetaMask to use this application!');
    }

    // Setup event listeners
    setupEventListeners();

    // Check if already connected
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
        await connectWallet();
    }
});

// Setup event listeners
function setupEventListeners() {
    // Account changed
    window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else {
            connectWallet();
        }
    });

    // Chain changed
    window.ethereum.on('chainChanged', () => {
        window.location.reload();
    });

    // Search input
    document.getElementById('searchInput').addEventListener('input', (e) => {
        const value = e.target.value;
        const clearBtn = document.getElementById('clearSearch');
        const hint = document.getElementById('searchHint');
        
        if (value) {
            clearBtn.style.display = 'flex';
            hint.style.display = 'block';
            hint.innerHTML = `Searching for: <strong>${value}</strong>`;
        } else {
            clearBtn.style.display = 'none';
            hint.style.display = 'none';
        }
        // Immediately apply search filter
        applyFilters(); 
    });

    // Add event listeners to filters (important for initial loading)
    document.getElementById('programFilter').addEventListener('change', applyFilters);
    document.getElementById('gradeFilter').addEventListener('change', applyFilters);
    document.getElementById('yearFilter').addEventListener('change', applyFilters);
}

// Connect wallet (UPDATED TO ETHERS V6 LOGIC)
async function connectWallet() {
    try {
        // 1. Initialize Ethers v6 Provider
        provider = new ethers.BrowserProvider(window.ethereum);

        // 2. Request account access
        const accounts = await provider.send("eth_requestAccounts", []);
        
        account = accounts[0];
        
        // 3. Get the Signer
        signer = await provider.getSigner();
        
        // 4. Check network
        const network = await provider.getNetwork();
        // APP_CONFIG.NETWORK_ID is 97 (BNB Testnet) from config.js
        if (network.chainId !== BigInt(APP_CONFIG.NETWORK_ID)) {
             // Attempt to switch the chain if needed
             try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${APP_CONFIG.NETWORK_ID.toString(16)}` }],
                });
                // Recurse to re-check the connection after switch
                await connectWallet(); 
                return;
             } catch (switchError) {
                // User rejected or switch failed
                alert(`Please manually switch MetaMask to ${APP_CONFIG.NETWORK_NAME} (Chain ID: ${APP_CONFIG.NETWORK_ID})`);
                return;
             }
        }
        
        // 5. Initialize contract
        contract = new ethers.Contract(
            APP_CONFIG.CONTRACT_ADDRESS,
            APP_CONFIG.CONTRACT_ABI,
            signer
        );
        
        // 6. Update UI
        updateWalletUI();
        
        // Show main app
        document.getElementById('connectPrompt').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        // Update footer links (using the correct config keys for BscScan)
        document.getElementById('contractLink').href = 
            `${APP_CONFIG.BSC_TESTNET_BASE_URL}/${APP_CONFIG.CONTRACT_ADDRESS}`;
        // Note: NFT_VIEW_BASE_URL is used for the OpenSea/Viewer link on BscScan
        document.getElementById('openseaLink').href = 
            `${APP_CONFIG.NFT_VIEW_BASE_URL}${APP_CONFIG.CONTRACT_ADDRESS}`;
        
        // Load certificates
        await loadCertificates();
        
    } catch (error) {
        console.error('Error connecting wallet:', error);
        alert('Failed to connect wallet: ' + error.message);
    }
}

// Disconnect wallet
function disconnectWallet() {
    account = null;
    provider = null;
    signer = null;
    contract = null;
    
    document.getElementById('connectPrompt').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('connectWallet').style.display = 'block';
    document.getElementById('walletInfo').style.display = 'none';
}

// Update wallet UI
function updateWalletUI() {
    const shortAddress = `${account.slice(0, 6)}...${account.slice(-4)}`;
    document.getElementById('walletAddress').textContent = shortAddress;
    document.getElementById('connectWallet').style.display = 'none';
    document.getElementById('walletInfo').style.display = 'flex';
}

// Load certificates
async function loadCertificates() {
    try {
        document.getElementById('loadingSpinner').style.display = 'block';
        document.getElementById('certificatesGrid').style.display = 'none';
        document.getElementById('noResults').style.display = 'none';
        
        // Get all token IDs
        // Ethers v6 handles BigNumber conversion automatically for returns
        const tokenIds = await contract.getAllTokenIds();
        console.log('Total certificates:', tokenIds.length);
        
        // Load each certificate
        const promises = tokenIds.map(async (tokenId) => {
            try {
                // Ethers v6 automatically converts BigInt to number for array access (safe for small token IDs)
                const [name, program, grade, year, timestamp] = await contract.getGraduate(tokenId);
                const owner = await contract.ownerOf(tokenId);
                const tokenURI = await contract.tokenURI(tokenId);
                
                return {
                    tokenId: Number(tokenId), // Use Number() for consistency in frontend rendering
                    name,
                    program,
                    grade,
                    year: Number(year),
                    timestamp: Number(timestamp),
                    owner,
                    tokenURI,
                    isOwner: owner.toLowerCase() === account.toLowerCase()
                };
            } catch (error) {
                console.error(`Error loading certificate ${tokenId}:`, error);
                return null;
            }
        });
        
        const results = await Promise.all(promises);
        allCertificates = results.filter(cert => cert !== null);
        
        console.log('Loaded certificates:', allCertificates.length);
        
        // Update stats
        updateStats();
        
        // Populate filters
        populateFilters();
        
        // Apply initial filters
        applyFilters();
        
        document.getElementById('loadingSpinner').style.display = 'none';
        
    } catch (error) {
        console.error('Error loading certificates:', error);
        document.getElementById('loadingSpinner').style.display = 'none';
        alert('Failed to load certificates. Please check the contract address and network.');
    }
}

// Update statistics
function updateStats() {
    document.getElementById('totalCerts').textContent = allCertificates.length;
    
    // Count unique programs
    const programs = new Set(allCertificates.map(c => c.program));
    document.getElementById('totalPrograms').textContent = programs.size;
    
    // Count my certificates
    const myCertificates = allCertificates.filter(c => c.isOwner);
    document.getElementById('myCerts').textContent = myCertificates.length;
}

// Populate filter dropdowns
function populateFilters() {
    // Clear previous options
    document.getElementById('programFilter').innerHTML = '<option value="All">All Programs</option>';
    document.getElementById('gradeFilter').innerHTML = '<option value="All">All Grades</option>';
    document.getElementById('yearFilter').innerHTML = '<option value="All">All Years</option>';
    
    // Programs
    const programs = [...new Set(allCertificates.map(c => c.program))].sort();
    const programSelect = document.getElementById('programFilter');
    programs.forEach(program => {
        const option = document.createElement('option');
        option.value = program;
        option.textContent = program;
        programSelect.appendChild(option);
    });
    
    // Grades
    const grades = [...new Set(allCertificates.map(c => c.grade))].sort();
    const gradeSelect = document.getElementById('gradeFilter');
    grades.forEach(grade => {
        const option = document.createElement('option');
        option.value = grade;
        option.textContent = grade;
        gradeSelect.appendChild(option);
    });
    
    // Years
    const years = [...new Set(allCertificates.map(c => c.year))].sort().reverse();
    const yearSelect = document.getElementById('yearFilter');
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    });
}

// Apply filters
function applyFilters() {
    let filtered = [...allCertificates];
    
    // Apply view mode
    if (viewMode === 'my') {
        filtered = filtered.filter(cert => cert.isOwner);
    }
    
    // Apply search
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(cert => 
            cert.name.toLowerCase().includes(searchTerm)
        );
    }
    
    // Apply program filter
    const programFilter = document.getElementById('programFilter').value;
    if (programFilter !== 'All') {
        filtered = filtered.filter(cert => cert.program === programFilter);
    }
    
    // Apply grade filter
    const gradeFilter = document.getElementById('gradeFilter').value;
    if (gradeFilter !== 'All') {
        filtered = filtered.filter(cert => cert.grade === gradeFilter);
    }
    
    // Apply year filter
    const yearFilter = document.getElementById('yearFilter').value;
    if (yearFilter !== 'All') {
        filtered = filtered.filter(cert => cert.year.toString() === yearFilter);
    }
    
    filteredCertificates = filtered;
    
    // Update filtered count
    document.getElementById('filteredCount').textContent = filtered.length;
    
    // Update active filters UI
    updateActiveFilters();
    
    // Display certificates
    displayCertificates(filtered);
}

// Update active filters display
function updateActiveFilters() {
    const searchTerm = document.getElementById('searchInput').value;
    const programFilter = document.getElementById('programFilter').value;
    const gradeFilter = document.getElementById('gradeFilter').value;
    const yearFilter = document.getElementById('yearFilter').value;
    
    const hasActiveFilters = 
        searchTerm || 
        programFilter !== 'All' || 
        gradeFilter !== 'All' || 
        yearFilter !== 'All';
    
    const filterBadge = document.getElementById('filterBadge');
    const resetBtn = document.getElementById('resetFiltersBtn');
    const activeFiltersDiv = document.getElementById('activeFilters');
    const filterTagsDiv = document.getElementById('filterTags');
    
    if (hasActiveFilters) {
        filterBadge.style.display = 'inline';
        resetBtn.style.display = 'block';
        activeFiltersDiv.style.display = 'block';
        
        // Build filter tags
        let tags = '';
        if (programFilter !== 'All') {
            tags += `<span class="filter-tag">Program: ${programFilter} <button onclick="removeFilter('program')">✕</button></span>`;
        }
        if (gradeFilter !== 'All') {
            tags += `<span class="filter-tag">Grade: ${gradeFilter} <button onclick="removeFilter('grade')">✕</button></span>`;
        }
        if (yearFilter !== 'All') {
            tags += `<span class="filter-tag">Year: ${yearFilter} <button onclick="removeFilter('year')">✕</button></span>`;
        }
        
        filterTagsDiv.innerHTML = tags;
    } else {
        filterBadge.style.display = 'none';
        resetBtn.style.display = 'none';
        activeFiltersDiv.style.display = 'none';
    }
}

// Display certificates
function displayCertificates(certificates) {
    const grid = document.getElementById('certificatesGrid');
    const noResults = document.getElementById('noResults');
    
    if (certificates.length === 0) {
        grid.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }
    
    grid.style.display = 'grid';
    noResults.style.display = 'none';
    
    grid.innerHTML = certificates.map(cert => createCertificateCard(cert)).join('');
}

// Create certificate card HTML
function createCertificateCard(cert) {
    const gradeColor = APP_CONFIG.GRADE_COLORS[cert.grade] || '#6b7280';
    const ownerBadge = cert.isOwner ? '<div class="owner-badge">🏆 You own this</div>' : '';
    const ownedClass = cert.isOwner ? 'owned' : '';
    
    return `
        <div class="certificate-card ${ownedClass}" onclick="showCertificateDetails(${cert.tokenId})">
            ${ownerBadge}
            <div class="certificate-image">
                <div class="certificate-visual">
                    <div class="certificate-header">
                        <h3>Certificate of Achievement</h3>
                    </div>
                    <div class="certificate-body">
                        <p class="cert-label">This certifies that</p>
                        <h2 class="graduate-name">${cert.name}</h2>
                        <p class="cert-label">has successfully completed</p>
                        <h3 class="program-name">${cert.program}</h3>
                        <div class="grade-badge" style="background-color: ${gradeColor}">
                            ${cert.grade}
                        </div>
                        <p class="cert-year">Class of ${cert.year}</p>
                    </div>
                    <div class="certificate-footer">
                        <div class="token-id">Token #${cert.tokenId}</div>
                    </div>
                </div>
            </div>
            <div class="certificate-info">
                <div class="info-row">
                    <span class="info-label">Graduate:</span>
                    <span class="info-value">${cert.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Program:</span>
                    <span class="info-value">${cert.program}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Grade:</span>
                    <span class="info-value" style="color: ${gradeColor}">${cert.grade}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Year:</span>
                    <span class="info-value">${cert.year}</span>
                </div>
            </div>
        </div>
    `;
}

// Show certificate details in modal
function showCertificateDetails(tokenId) {
    const cert = allCertificates.find(c => c.tokenId === tokenId);
    if (!cert) return;
    
    const gradeColor = APP_CONFIG.GRADE_COLORS[cert.grade] || '#6b7280';
    const shortOwner = `${cert.owner.slice(0, 6)}...${cert.owner.slice(-4)}`;
    const date = new Date(cert.timestamp * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Use the NFT viewer link configured for BscScan
    const certViewerLink = `${APP_CONFIG.NFT_VIEW_BASE_URL}${APP_CONFIG.CONTRACT_ADDRESS}/${tokenId}`;
    
    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <h2>Certificate Details #${tokenId}</h2>
        <div style="margin-top: 1.5rem;">
            <div class="info-row">
                <span class="info-label">Graduate Name:</span>
                <span class="info-value">${cert.name}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Program:</span>
                <span class="info-value">${cert.program}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Grade:</span>
                <span class="info-value" style="color: ${gradeColor}">${cert.grade}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Graduation Year:</span>
                <span class="info-value">${cert.year}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Owner:</span>
                <span class="info-value" style="font-family: monospace; font-size: 0.8rem;" title="${cert.owner}">${shortOwner}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Issued:</span>
                <span class="info-value">${date}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Token ID:</span>
                <span class="info-value">#${tokenId}</span>
            </div>
        </div>
        <div style="margin-top: 2rem;">
            <a href="${certViewerLink}" target="_blank" class="btn-primary" style="display: inline-block; text-decoration: none; text-align: center; width: 100%;">
                View Certificate on BscScan
            </a>
        </div>
    `;
    
    document.getElementById('certModal').style.display = 'flex';
}

// Close modal
function closeModal() {
    document.getElementById('certModal').style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('certModal');
    if (event.target === modal) {
        closeModal();
    }
}

// Set view mode
function setViewMode(mode) {
    viewMode = mode;
    
    // Update button styles
    document.getElementById('allCertsBtn').classList.toggle('active', mode === 'all');
    document.getElementById('myCertsBtn').classList.toggle('active', mode === 'my');
    
    // Apply filters
    applyFilters();
}

// Toggle filters visibility
function toggleFilters() {
    const content = document.getElementById('filterContent');
    content.style.display = content.style.display === 'none' ? 'grid' : 'none';
}

// Clear search
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearch').style.display = 'none';
    document.getElementById('searchHint').style.display = 'none';
    applyFilters();
}

// Reset all filters
function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('programFilter').value = 'All';
    document.getElementById('gradeFilter').value = 'All';
    document.getElementById('yearFilter').value = 'All';
    document.getElementById('clearSearch').style.display = 'none';
    document.getElementById('searchHint').style.display = 'none';
    applyFilters();
}

// Remove specific filter
function removeFilter(type) {
    if (type === 'program') {
        document.getElementById('programFilter').value = 'All';
    } else if (type === 'grade') {
        document.getElementById('gradeFilter').value = 'All';
    } else if (type === 'year') {
        document.getElementById('yearFilter').value = 'All';
    }
    applyFilters();
}

// Make functions globally available
window.connectWallet = connectWallet;
window.setViewMode = setViewMode;
window.toggleFilters = toggleFilters;
window.clearSearch = clearSearch;
window.resetFilters = resetFilters;
window.removeFilter = removeFilter;
window.showCertificateDetails = showCertificateDetails;
window.closeModal = closeModal;
window.applyFilters = applyFilters;