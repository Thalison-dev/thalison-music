'use strict';

const API = 'https://discoveryprovider.audius.co/v1';
const APP_NAME = 'thalison_music';

const audio = document.getElementById('audio');
const $ = (id) => document.getElementById(id);

let currentTrack = null;
let currentList = [];
let libraryMode = 'favorites';
let toastTimer;

const store = {
    get(key, fallback = []) {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
};

// Mantém as chaves antigas para preservar favoritos e histórico existentes.
const favorites = () => store.get('nova_favorites');
const recent = () => store.get('nova_recent');

function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function artOf(track) {
    const artwork = track?.artwork;
    if (typeof artwork === 'string') return artwork;
    return artwork?.['480x480'] || artwork?.['150x150'] ||
        artwork?.['1000x1000'] || 'icon.svg';
}

function normalize(track) {
    if (!track || track.id == null) return null;
    return {
        id: String(track.id),
        title: track.title || 'Faixa sem título',
        artist: track.user?.name || track.artist || 'Artista independente',
        artwork: artOf(track),
        duration: Number(track.duration || 0),
        permalink: track.permalink || '',
        is_streamable: track.is_streamable !== false
    };
}

function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

async function api(path) {
    const url = new URL(API + path);
    url.searchParams.set('app_name', APP_NAME);

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });

    const raw = await response.text();
    let json = {};

    try {
        json = raw ? JSON.parse(raw) : {};
    } catch {
        throw new Error(`Resposta inválida da Audius (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        const detail = json?.message || json?.error ||
            json?.errors?.[0]?.message || response.statusText || 'Erro desconhecido';
        throw new Error(`Audius HTTP ${response.status}: ${detail}`);
    }

    if (json.error) {
        throw new Error(typeof json.error === 'string'
            ? json.error : JSON.stringify(json.error));
    }

    return json.data ?? [];
}

function renderTracks(container, tracks, emptyMessage = 'Nenhuma música encontrada.') {
    if (!container) return;

    const list = (tracks || [])
        .map(normalize)
        .filter(track => track && track.id && track.is_streamable);

    if (!list.length) {
        container.innerHTML = `<div class="empty-state">${safeText(emptyMessage)}</div>`;
        return;
    }

    container.innerHTML = list.map(track => {
        const saved = favorites().some(item => item.id === track.id);
        return `
            <article class="track-row" data-track="${safeText(track.id)}">
                <img class="track-art" src="${safeText(track.artwork)}"
                     alt="Capa" loading="lazy" onerror="this.src='icon.svg'">
                <div class="track-info">
                    <strong>${safeText(track.title)}</strong>
                    <span>${safeText(track.artist)}</span>
                </div>
                <button class="heart-button ${saved ? 'saved' : ''}"
                        data-fav="${safeText(track.id)}" aria-label="Favoritar">
                    ${saved ? '♥' : '♡'}
                </button>
                <button class="track-play" data-play="${safeText(track.id)}"
                        aria-label="Reproduzir">▶</button>
            </article>`;
    }).join('');

    list.forEach(track => {
        const element = container.querySelector(
            `[data-track="${CSS.escape(track.id)}"]`
        );
        if (element) element.dataset.trackData = JSON.stringify(track);
    });
}

async function loadHome() {
    const trendingBox = $('trendingList');
    const newBox = $('newList');

    if (trendingBox) {
        trendingBox.innerHTML = '<div class="loading">Carregando músicas em alta...</div>';
    }
    if (newBox) {
        newBox.innerHTML = '<div class="loading">Buscando lançamentos...</div>';
    }

    // Carrega as seções separadamente para que uma falha não afete a outra.
    try {
        let trending;
        try {
            trending = await api('/tracks/trending?time=week&limit=12');
        } catch (firstError) {
            console.warn('Falha nas tendências semanais:', firstError);
            trending = await api('/tracks/trending?limit=12');
        }
        renderTracks(trendingBox, trending, 'Nenhuma música em alta encontrada.');
    } catch (error) {
        console.error('Erro nas tendências:', error);
        if (trendingBox) {
            trendingBox.innerHTML = `<div class="empty-state">
                Não foi possível carregar as músicas em alta.<br>
                <small>${safeText(error.message)}</small>
            </div>`;
        }
    }

    try {
        let fresh;
        try {
            fresh = await api('/tracks/best_new_releases?limit=12');
        } catch (firstError) {
            console.warn('Falha nos melhores lançamentos:', firstError);
            fresh = await api('/tracks/latest?limit=12');
        }
        renderTracks(newBox, fresh, 'Nenhum lançamento encontrado agora.');
    } catch (error) {
        console.error('Erro nos lançamentos:', error);
        if (newBox) {
            newBox.innerHTML = `<div class="empty-state">
                Não foi possível carregar os lançamentos.<br>
                <small>${safeText(error.message)}</small>
            </div>`;
        }
    }
}

async function searchTracks(query) {
    if (!query || !query.trim()) return;
    const resultsBox = $('searchResults');
    if (!resultsBox) return;

    resultsBox.innerHTML = '<div class="loading">Procurando...</div>';
    try {
        const results = await api(
            `/tracks/search?query=${encodeURIComponent(query.trim())}&limit=25`
        );
        renderTracks(resultsBox, results, 'Nenhuma faixa encontrada.');
    } catch (error) {
        console.error('Erro na pesquisa:', error);
        resultsBox.innerHTML = `<div class="empty-state">
            Erro na pesquisa:<br><small>${safeText(error.message)}</small>
        </div>`;
    }
}

async function playTrack(track) {
    if (!track?.id) return;

    currentTrack = track;
    currentList = currentList.length ? currentList : [track];

    $('playerTitle').textContent = track.title;
    $('playerArtist').textContent = track.artist;
    $('playerArt').src = track.artwork;
    $('fullArt').src = track.artwork;
    $('fullTitle').textContent = track.title;
    $('fullArtist').textContent = track.artist;
    $('playerBar').classList.remove('hidden');
    updateFavoriteButtons();

    try {
        const streamUrl = new URL(
            `${API}/tracks/${encodeURIComponent(track.id)}/stream`
        );
        streamUrl.searchParams.set('app_name', APP_NAME);

        audio.pause();
        audio.src = streamUrl.toString();
        audio.load();
        await audio.play();
        updatePlayButtons();

        const history = recent();
        store.set('nova_recent', [
            track, ...history.filter(item => item.id !== track.id)
        ].slice(0, 30));
    } catch (error) {
        console.error('Erro ao reproduzir:', error);
        showToast(error.message || 'Não foi possível reproduzir esta faixa.');
    }
}

function updatePlayButtons() {
    const playing = audio && !audio.paused;
    if ($('playPauseBtn')) $('playPauseBtn').textContent = playing ? 'Ⅱ' : '▶';
    if ($('fullPlayPause')) $('fullPlayPause').textContent = playing ? 'Ⅱ' : '▶';
}

function toggleFavorite(track) {
    const list = favorites();
    const exists = list.some(item => item.id === track.id);

    store.set('nova_favorites', exists
        ? list.filter(item => item.id !== track.id)
        : [track, ...list]);

    updateFavoriteButtons();
    if ($('libraryView')?.classList.contains('active')) renderLibrary();
    showToast(exists ? 'Removida das favoritas' : 'Adicionada às favoritas');
}

function updateFavoriteButtons() {
    if (!currentTrack) return;
    const saved = favorites().some(item => item.id === currentTrack.id);
    if ($('favoriteCurrent')) $('favoriteCurrent').textContent = saved ? '♥' : '♡';
    if ($('fullFavorite')) $('fullFavorite').textContent = saved ? '♥' : '♡';
}

function renderLibrary() {
    const items = libraryMode === 'favorites' ? favorites() : recent();
    renderTracks($('libraryList'), items,
        libraryMode === 'favorites'
            ? 'Suas músicas favoritas aparecerão aqui.'
            : 'As músicas que você tocar aparecerão aqui.');
}

function openView(name) {
    const ids = {
        inicio: 'homeView',
        buscar: 'searchView',
        biblioteca: 'libraryView'
    };
    if (!ids[name] || !$(ids[name])) return;

    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $(ids[name]).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(button => {
        button.classList.toggle('active', button.dataset.view === name);
    });

    if (name === 'biblioteca') renderLibrary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function trackFromButton(button) {
    const row = button.closest('.track-row');
    if (!row) return null;
    try {
        return JSON.parse(row.dataset.trackData);
    } catch {
        return null;
    }
}

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) openView(nav.dataset.view);

    const go = event.target.closest('[data-go]');
    if (go) openView(go.dataset.go);

    const play = event.target.closest('[data-play]');
    if (play) {
        const track = trackFromButton(play);
        if (track) {
            const listElement = play.closest('.track-list');
            currentList = listElement
                ? [...listElement.querySelectorAll('.track-row')]
                    .map(row => {
                        try { return JSON.parse(row.dataset.trackData); }
                        catch { return null; }
                    })
                    .filter(Boolean)
                : [track];
            playTrack(track);
        }
    }

    const favoriteButton = event.target.closest('[data-fav]');
    if (favoriteButton) {
        const track = trackFromButton(favoriteButton);
        if (track) toggleFavorite(track);
    }

    const libraryTab = event.target.closest('[data-library]');
    if (libraryTab) {
        libraryMode = libraryTab.dataset.library;
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab === libraryTab);
        });
        renderLibrary();
    }
});

if ($('searchForm')) {
    $('searchForm').addEventListener('submit', event => {
        event.preventDefault();
        searchTracks($('searchInput').value);
    });
}

if ($('refreshBtn')) $('refreshBtn').addEventListener('click', loadHome);
if ($('newReleasesBtn')) $('newReleasesBtn').addEventListener('click', loadHome);

if ($('playPauseBtn')) {
    $('playPauseBtn').addEventListener('click', () => {
        if (audio.paused) audio.play().catch(() => showToast('Toque em reproduzir novamente.'));
        else audio.pause();
    });
}

if ($('fullPlayPause')) {
    $('fullPlayPause').addEventListener('click', () => {
        if (audio.paused) audio.play().catch(() => showToast('Toque em reproduzir novamente.'));
        else audio.pause();
    });
}

if ($('favoriteCurrent')) {
    $('favoriteCurrent').addEventListener('click', () => {
        if (currentTrack) toggleFavorite(currentTrack);
    });
}

if ($('fullFavorite')) {
    $('fullFavorite').addEventListener('click', () => {
        if (currentTrack) toggleFavorite(currentTrack);
    });
}

if ($('expandPlayer')) {
    $('expandPlayer').addEventListener('click', () => $('fullPlayer').classList.add('open'));
}
if ($('closePlayer')) {
    $('closePlayer').addEventListener('click', () => $('fullPlayer').classList.remove('open'));
}
if ($('backBtn')) {
    $('backBtn').addEventListener('click', () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
}
if ($('forwardBtn')) {
    $('forwardBtn').addEventListener('click', () => {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    });
}
if ($('seekBar')) {
    $('seekBar').addEventListener('input', event => {
        if (audio.duration) {
            audio.currentTime = audio.duration * Number(event.target.value) / 100;
        }
    });
}

if (audio) {
    audio.addEventListener('play', updatePlayButtons);
    audio.addEventListener('pause', updatePlayButtons);

    audio.addEventListener('timeupdate', () => {
        const percentage = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
        if ($('progressFill')) $('progressFill').style.width = percentage + '%';
        if ($('seekBar')) $('seekBar').value = percentage;
        if ($('currentTime')) $('currentTime').textContent = formatTime(audio.currentTime);
        if ($('totalTime')) $('totalTime').textContent = formatTime(audio.duration);
    });

    audio.addEventListener('ended', () => {
        updatePlayButtons();
        if (currentList.length > 1 && currentTrack) {
            const index = currentList.findIndex(item => item.id === currentTrack.id);
            const next = currentList[(index + 1) % currentList.length];
            if (next) playTrack(next);
        }
    });

    audio.addEventListener('error', () => {
        showToast('Não foi possível carregar o áudio desta faixa.');
    });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .catch(error => console.warn('Service worker:', error));
    });
}

loadHome();


// YouTube: pesquisa externa e reprodução pelo player oficial incorporado.
function extractYouTubeId(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
            if (url.pathname === '/watch') return url.searchParams.get('v');
            const parts = url.pathname.split('/').filter(Boolean);
            if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || null;
        }
    } catch {
        return null;
    }
    return null;
}

const youtubeSearchForm = $('youtubeSearchForm');
const youtubeLinkForm = $('youtubeLinkForm');
const youtubeFrame = $('youtubeFrame');
const youtubeFrameWrap = $('youtubeFrameWrap');

if (youtubeSearchForm) {
    youtubeSearchForm.addEventListener('submit', event => {
        event.preventDefault();
        const query = $('youtubeSearchInput')?.value.trim();
        if (!query) {
            showToast('Digite o nome da música ou do artista.');
            return;
        }
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    });
}

if (youtubeLinkForm) {
    youtubeLinkForm.addEventListener('submit', event => {
        event.preventDefault();
        const input = $('youtubeLinkInput');
        const videoId = extractYouTubeId(input?.value);
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            showToast('Cole um link válido de vídeo do YouTube.');
            return;
        }
        if (audio && !audio.paused) audio.pause();
        youtubeFrame.src = `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0`;
        youtubeFrameWrap?.classList.remove('hidden');
        youtubeFrameWrap?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('Vídeo carregado no player do YouTube.');
    });
}

const closeYoutube = $('closeYoutube');
if (closeYoutube) {
    closeYoutube.addEventListener('click', () => {
        if (youtubeFrame) youtubeFrame.src = '';
        youtubeFrameWrap?.classList.add('hidden');
    });
}
