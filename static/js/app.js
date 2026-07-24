// State Variables
let selectedProject = null;
let selectedTimeline = null;
let selectedVideo = null;
let selectedStoryboardTimeline = null;
let selectedGalleryImage = null;

let currentHotkey = localStorage.getItem('snapshot_hotkey') || 's';
let isBindingHotkey = false;
let captureGallery = [];

let currentPlayingAudio = null;
let currentPlayingButton = null;

let isSelectionMode = false;
const selectedSnapshotPaths = new Set();

// DOM Elements
const selectProject = document.getElementById('select-project');
const selectTimeline = document.getElementById('select-timeline');
const selectVideo = document.getElementById('select-video');
const selectStoryboardTimeline = document.getElementById('select-storyboard-timeline');
const btnReloadStoryboard = document.getElementById('btn-reload-storyboard');

const inputOutputDir = document.getElementById('input-output-dir');
const selectResolution = document.getElementById('select-resolution');
const selectFormat = document.getElementById('select-format');
const selectEnhancement = document.getElementById('select-enhancement');
const btnBindHotkey = document.getElementById('btn-bind-hotkey');
const labelCurrentHotkey = document.getElementById('label-current-hotkey');

const videoPlayer = document.getElementById('video-player');
const playerOverlay = document.getElementById('player-overlay');
const transcodeLoading = document.getElementById('transcode-loading');
const transcodeMessage = document.getElementById('transcode-message');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnStepBack = document.getElementById('btn-step-back');
const btnStepForward = document.getElementById('btn-step-forward');
const selectSpeed = document.getElementById('select-speed');
const timecodeDisplay = document.getElementById('timecode-display');
const sliderSeek = document.getElementById('slider-seek');
const btnCapture = document.getElementById('btn-capture');

const capcutStatusBadge = document.getElementById('capcut-status-badge');
const btnKillCapcut = document.getElementById('btn-kill-capcut');
const btnLaunchCapcut = document.getElementById('btn-launch-capcut');
const snapshotGallery = document.getElementById('snapshot-gallery');
const galleryCount = document.getElementById('gallery-count');
const btnToggleSelect = document.getElementById('btn-toggle-select');
const btnDeleteSelected = document.getElementById('btn-delete-selected');
const consoleOutput = document.getElementById('console-output');

const storyboardTimeline = document.getElementById('storyboard-timeline');

// Modal Elements
const previewModal = document.getElementById('preview-modal');
const imgModalPreview = document.getElementById('img-modal-preview');
const modalCaption = document.getElementById('modal-caption');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Load snapshot gallery from localStorage
    try {
        const savedGallery = localStorage.getItem('capture_gallery');
        if (savedGallery) {
            captureGallery = JSON.parse(savedGallery);
            renderGallery();
        }
    } catch (e) {
        console.error("Error reading saved gallery:", e);
    }

    // Load saved settings
    inputOutputDir.value = localStorage.getItem('output_dir') || '';
    selectResolution.value = localStorage.getItem('resolution') || 'original';
    selectFormat.value = localStorage.getItem('format') || 'png';
    selectEnhancement.value = localStorage.getItem('enhancement') || 'cas';

    // Fetch CapCut status and projects
    checkCapCutStatus();
    setInterval(checkCapCutStatus, 3000);

    // Initial projects load
    await loadProjects();

    // Restore project workspace selection
    await restoreWorkspaceSelection();

    // Setup Hotkey Bindings
    labelCurrentHotkey.textContent = currentHotkey.toUpperCase();
    btnBindHotkey.addEventListener('click', () => {
        isBindingHotkey = true;
        btnBindHotkey.textContent = 'Press any key...';
        btnBindHotkey.classList.add('btn-primary');
    });

    // Global Key Listener (Capture phase to override default browser events)
    window.addEventListener('keydown', handleGlobalKeydown, true);

    // Dropdown change events
    selectProject.addEventListener('change', onProjectChange);
    selectTimeline.addEventListener('change', onTimelineChange);
    selectVideo.addEventListener('change', onVideoChange);
    selectStoryboardTimeline.addEventListener('change', onStoryboardTimelineChange);
    btnReloadStoryboard.addEventListener('click', loadStoryboard);
    btnToggleSelect.addEventListener('click', toggleSelectionMode);
    btnDeleteSelected.addEventListener('click', deleteSelectedSnapshots);

    // Settings saving listeners
    inputOutputDir.addEventListener('input', (e) => {
        localStorage.setItem('output_dir', e.target.value.trim());
    });
    selectResolution.addEventListener('change', (e) => {
        localStorage.setItem('resolution', e.target.value);
    });
    selectFormat.addEventListener('change', (e) => {
        localStorage.setItem('format', e.target.value);
    });
    selectEnhancement.addEventListener('change', (e) => {
        localStorage.setItem('enhancement', e.target.value);
    });

    // Player Events
    videoPlayer.addEventListener('timeupdate', onVideoTimeupdate);
    videoPlayer.addEventListener('loadedmetadata', onVideoLoadedMetadata);
    videoPlayer.addEventListener('play', () => {
        btnPlayPause.textContent = '⏸';
        playerOverlay.style.opacity = '0';
    });
    videoPlayer.addEventListener('pause', () => {
        btnPlayPause.textContent = '▶';
        playerOverlay.style.opacity = '1';
    });

    btnPlayPause.addEventListener('click', togglePlayPause);
    playerOverlay.addEventListener('click', togglePlayPause);

    // Frame stepping (1/30s)
    const frameStep = 1.0 / 30.0;
    btnStepForward.addEventListener('click', () => {
        videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + frameStep);
    });
    btnStepBack.addEventListener('click', () => {
        videoPlayer.currentTime = Math.max(0.0, videoPlayer.currentTime - frameStep);
    });

    selectSpeed.addEventListener('change', (e) => {
        videoPlayer.playbackRate = parseFloat(e.target.value);
    });

    sliderSeek.addEventListener('input', (e) => {
        videoPlayer.currentTime = parseFloat(e.target.value);
    });

    btnCapture.addEventListener('click', triggerCapture);
});

// --- Workspace State Persistence ---

async function restoreWorkspaceSelection() {
    const savedProject = localStorage.getItem('selected_project');
    if (savedProject && selectProject.querySelector(`option[value="${savedProject}"]`)) {
        selectProject.value = savedProject;
        await onProjectChange({ target: { value: savedProject } }, true);
        
        const savedTimeline = localStorage.getItem('selected_timeline');
        if (savedTimeline && selectTimeline.querySelector(`option[value="${savedTimeline}"]`)) {
            selectTimeline.value = savedTimeline;
            await onTimelineChange({ target: { value: savedTimeline } }, true);
            
            const savedVideo = localStorage.getItem('selected_video');
            if (savedVideo && selectVideo.querySelector(`option[value="${savedVideo}"]`)) {
                selectVideo.value = savedVideo;
                onVideoChange({ target: { value: savedVideo } });
            }
        }
        
        const savedStoryboardTimeline = localStorage.getItem('selected_storyboard_timeline');
        if (savedStoryboardTimeline && selectStoryboardTimeline.querySelector(`option[value="${savedStoryboardTimeline}"]`)) {
            selectStoryboardTimeline.value = savedStoryboardTimeline;
            await onStoryboardTimelineChange({ target: { value: savedStoryboardTimeline } });
        }
    }
}

// --- API Calls ---

async function loadProjects() {
    appendLog("Fetching CapCut projects...");
    try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        
        if (data.error) {
            appendLog(`Error: ${data.error}`, true);
            return;
        }

        const projects = data.projects || [];
        selectProject.innerHTML = '<option value="">-- Select Project --</option>';
        projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.folder_name;
            opt.dataset.rawJson = JSON.stringify(p);
            opt.textContent = p.name;
            selectProject.appendChild(opt);
        });
        appendLog(`Loaded ${projects.length} projects successfully.`);
    } catch (e) {
        appendLog(`Network error loading projects: ${e.message}`, true);
    }
}

async function onProjectChange(e, isRestoring = false) {
    const folderName = e.target.value;
    selectTimeline.innerHTML = '<option value="">-- Choose project first --</option>';
    selectTimeline.disabled = true;
    selectVideo.innerHTML = '<option value="">-- Choose timeline first --</option>';
    selectVideo.disabled = true;
    
    selectStoryboardTimeline.innerHTML = '<option value="">-- Choose project first --</option>';
    selectStoryboardTimeline.disabled = true;
    btnReloadStoryboard.disabled = true;
    
    resetPlayer();
    storyboardTimeline.innerHTML = '<div class="empty-state">Select a project and a target timeline above to load the voice storyboard.</div>';

    if (!folderName) {
        selectedProject = null;
        localStorage.removeItem('selected_project');
        localStorage.removeItem('selected_timeline');
        localStorage.removeItem('selected_video');
        localStorage.removeItem('selected_storyboard_timeline');
        return;
    }

    const selectedOpt = selectProject.options[selectProject.selectedIndex];
    selectedProject = JSON.parse(selectedOpt.dataset.rawJson);
    if (!isRestoring) {
        localStorage.setItem('selected_project', folderName);
        localStorage.removeItem('selected_timeline');
        localStorage.removeItem('selected_video');
        localStorage.removeItem('selected_storyboard_timeline');
    }

    appendLog(`Selected project: "${selectedProject.name}"`);

    selectTimeline.innerHTML = '<option value="">Loading timelines...</option>';
    selectStoryboardTimeline.innerHTML = '<option value="">Loading timelines...</option>';
    
    try {
        const response = await fetch(`/api/projects/${folderName}/timelines`);
        const data = await response.json();
        
        if (data.error) {
            appendLog(`Failed to fetch timelines: ${data.error}`, true);
            return;
        }

        const timelines = data.timelines || [];
        selectTimeline.innerHTML = '<option value="">-- Choose Timeline --</option>';
        selectStoryboardTimeline.innerHTML = '<option value="">-- Select Target Audio Timeline --</option>';
        
        timelines.forEach(t => {
            const opt1 = document.createElement('option');
            opt1.value = t.uuid;
            opt1.dataset.rawJson = JSON.stringify(t);
            opt1.textContent = `${t.name} (Clips: ${t.segments_count})`;
            selectTimeline.appendChild(opt1);
            
            const opt2 = document.createElement('option');
            opt2.value = t.uuid;
            opt2.dataset.rawJson = JSON.stringify(t);
            opt2.textContent = `${t.name} (Clips: ${t.segments_count})`;
            selectStoryboardTimeline.appendChild(opt2);
        });
        
        selectTimeline.disabled = false;
        selectStoryboardTimeline.disabled = false;
        appendLog(`Loaded ${timelines.length} timelines.`);
    } catch (err) {
        appendLog(`Error loading timelines: ${err.message}`, true);
    }
}

async function onTimelineChange(e, isRestoring = false) {
    const timelineUuid = e.target.value;
    selectVideo.innerHTML = '<option value="">-- Choose timeline first --</option>';
    selectVideo.disabled = true;
    resetPlayer();

    if (!timelineUuid) {
        selectedTimeline = null;
        localStorage.removeItem('selected_timeline');
        localStorage.removeItem('selected_video');
        return;
    }

    const selectedOpt = selectTimeline.options[selectTimeline.selectedIndex];
    selectedTimeline = JSON.parse(selectedOpt.dataset.rawJson);
    if (!isRestoring) {
        localStorage.setItem('selected_timeline', timelineUuid);
        localStorage.removeItem('selected_video');
    }

    appendLog(`Selected source timeline: "${selectedTimeline.name}"`);

    selectVideo.innerHTML = '<option value="">Loading video list...</option>';
    try {
        const response = await fetch(`/api/projects/${selectedProject.folder_name}/timelines/${timelineUuid}/videos`);
        const data = await response.json();
        
        if (data.error) {
            appendLog(`Failed to load videos: ${data.error}`, true);
            return;
        }

        const videos = data.videos || [];
        selectVideo.innerHTML = '<option value="">-- Select Video --</option>';
        videos.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.path;
            opt.dataset.rawJson = JSON.stringify(v);
            opt.textContent = `${v.name} (${v.width}x${v.height})`;
            selectVideo.appendChild(opt);
        });
        
        if (videos.length === 0) {
            selectVideo.innerHTML = '<option value="">No video files in this timeline</option>';
            appendLog("Notice: This timeline doesn't have any video assets.", true);
        } else {
            selectVideo.disabled = false;
            appendLog(`Found ${videos.length} unique video assets in this timeline.`);
        }
    } catch (err) {
        appendLog(`Error fetching videos: ${err.message}`, true);
    }
}

function onVideoChange(e) {
    const videoPath = e.target.value;
    resetPlayer();

    if (!videoPath) {
        selectedVideo = null;
        localStorage.removeItem('selected_video');
        return;
    }

    const selectedOpt = selectVideo.options[selectVideo.selectedIndex];
    selectedVideo = JSON.parse(selectedOpt.dataset.rawJson);
    localStorage.setItem('selected_video', videoPath);
    appendLog(`Selected video: "${selectedVideo.name}"`);

    checkAndLoadVideo(videoPath);
}

// --- Video Loading and Transcoding Handler ---

async function checkAndLoadVideo(videoPath) {
    if (videoPath.toLowerCase().endsWith('.mp4')) {
        loadPlayerStream(videoPath);
        return;
    }
    
    appendLog("Checking web playback compatibility for non-mp4 format (e.g. .ts)...");
    try {
        transcodeLoading.style.display = 'flex';
        transcodeMessage.textContent = "Checking for video preview proxy...";
        
        const response = await fetch('/api/video/transcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: videoPath })
        });
        const data = await response.json();
        
        if (data.status === "ready") {
            transcodeLoading.style.display = 'none';
            loadPlayerStream(videoPath);
        } else {
            pollTranscodeStatus(videoPath);
        }
    } catch (err) {
        transcodeLoading.style.display = 'none';
        appendLog(`Transcode error: ${err.message}`, true);
    }
}

function pollTranscodeStatus(videoPath) {
    transcodeMessage.textContent = "Transcoding video for browser playback... (Takes a few seconds)";
    appendLog("Generating low-bitrate MP4 preview proxy in the background...");
    
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/video/transcode_status?path=${encodeURIComponent(videoPath)}`);
            const data = await res.json();
            
            if (data.status === "ready") {
                clearInterval(interval);
                transcodeLoading.style.display = 'none';
                appendLog("Preview proxy ready! Loading player...");
                loadPlayerStream(videoPath);
            } else if (data.status === "failed") {
                clearInterval(interval);
                transcodeLoading.style.display = 'none';
                appendLog("Error: FFmpeg failed to transcode preview proxy.", true);
                alert("Failed to transcode video. Playback disabled, but you can still try capturing frames.");
            }
        } catch (e) {
            clearInterval(interval);
            transcodeLoading.style.display = 'none';
            appendLog(`Status poll failed: ${e.message}`, true);
        }
    }, 2000);
}

function loadPlayerStream(videoPath) {
    const streamUrl = `/api/video/stream?path=${encodeURIComponent(videoPath)}`;
    videoPlayer.src = streamUrl;
    videoPlayer.load();
    
    btnPlayPause.disabled = false;
    btnStepBack.disabled = false;
    btnStepForward.disabled = false;
    selectSpeed.disabled = false;
    sliderSeek.disabled = false;
    btnCapture.disabled = false;
}

// --- Player Controls Logic ---

function resetPlayer() {
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    btnPlayPause.disabled = true;
    btnStepBack.disabled = true;
    btnStepForward.disabled = true;
    selectSpeed.disabled = true;
    sliderSeek.disabled = true;
    btnCapture.disabled = true;
    timecodeDisplay.textContent = '00:00:00:00';
    sliderSeek.value = 0;
    transcodeLoading.style.display = 'none';
}

function togglePlayPause() {
    if (!videoPlayer.src) return;
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

// Blur utility to prevent spacebar/arrow keys from re-triggering buttons
function blurActiveElement() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
}

function onVideoLoadedMetadata() {
    sliderSeek.max = videoPlayer.duration;
    sliderSeek.value = 0;
    updateTimecode(0);
    appendLog(`Video dimensions: ${videoPlayer.videoWidth}x${videoPlayer.videoHeight}`);
}

// Ensure the custom seek bar updates on metadata load
function onVideoTimeupdate() {
    sliderSeek.value = videoPlayer.currentTime;
    updateTimecode(videoPlayer.currentTime);
}

function updateTimecode(currentTime) {
    const hours = Math.floor(currentTime / 3600);
    const minutes = Math.floor((currentTime % 3600) / 60);
    const seconds = Math.floor(currentTime % 60);
    const frames = Math.floor((currentTime % 1) * 30);
    
    const hStr = String(hours).padStart(2, '0');
    const mStr = String(minutes).padStart(2, '0');
    const sStr = String(seconds).padStart(2, '0');
    const fStr = String(frames).padStart(2, '0');
    
    timecodeDisplay.textContent = `${hStr}:${mStr}:${sStr}:${fStr}`;
}

// --- Capture Frame Logic ---

async function triggerCapture() {
    if (!selectedVideo) return;
    
    await checkCapCutStatus();
    
    const payload = {
        video_path: selectedVideo.path,
        timestamp_sec: videoPlayer.currentTime,
        output_dir: inputOutputDir.value.trim(),
        resolution: selectResolution.value,
        format: selectFormat.value,
        enhancement: selectEnhancement.value,
        video_width: selectedVideo.width,
        video_height: selectedVideo.height,
        project_name: selectedProject ? selectedProject.folder_name : null,
        timeline_uuid: selectedTimeline ? selectedTimeline.uuid : null
    };

    btnCapture.disabled = true;
    appendLog(`Capturing high-resolution frame at ${videoPlayer.currentTime.toFixed(3)}s...`);

    try {
        const response = await fetch('/api/video/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        if (data.success) {
            appendLog(`Saved image: "${data.filename}"`);
            if (data.imported) {
                appendLog("Import Successful: Frame imported to CapCut Media Panel.");
            } else if (data.import_error) {
                appendLog(`Import Note: ${data.import_error}`, true);
            }
            
            const newSnap = {
                filename: data.filename,
                path: data.filepath,
                time: videoPlayer.currentTime,
                width: data.width,
                height: data.height,
                material_id: data.material_id,
                imported: data.imported
            };
            
            captureGallery.unshift(newSnap);
            localStorage.setItem('capture_gallery', JSON.stringify(captureGallery));
            renderGallery();
            
            selectGalleryImage(0);
        } else {
            appendLog(`Capture failed: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Error capturing frame: ${err.message}`, true);
    } finally {
        btnCapture.disabled = false;
        blurActiveElement();
    }
}

function renderGallery() {
    galleryCount.textContent = captureGallery.length;
    if (captureGallery.length === 0) {
        snapshotGallery.innerHTML = '<div class="empty-state">No snapshots captured yet. Press the hotkey to save frames.</div>';
        return;
    }

    snapshotGallery.innerHTML = '';
    captureGallery.forEach((snap, idx) => {
        const card = document.createElement('div');
        card.className = 'snapshot-card';
        card.setAttribute('draggable', 'true');
        
        if (isSelectionMode) {
            card.classList.add('selecting');
            if (selectedSnapshotPaths.has(snap.path)) {
                card.classList.add('selected');
            }
        } else if (selectedGalleryImage && selectedGalleryImage.path === snap.path) {
            card.classList.add('selected');
        }
        
        // DRAG EVENTS
        card.addEventListener('dragstart', (e) => {
            if (isSelectionMode) {
                e.preventDefault();
                return;
            }
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                path: snap.path,
                material_id: snap.material_id,
                filename: snap.filename
            }));
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });
        
        card.addEventListener('click', (e) => {
            if (isSelectionMode) {
                // Toggle select
                if (selectedSnapshotPaths.has(snap.path)) {
                    selectedSnapshotPaths.delete(snap.path);
                    card.classList.remove('selected');
                } else {
                    selectedSnapshotPaths.add(snap.path);
                    card.classList.add('selected');
                }
                updateDeleteButtonState();
                return;
            }
            
            if (e.target.classList.contains('snap-thumbnail')) {
                return;
            }
            selectGalleryImage(idx);
        });
        
        const timestamp = snap.time.toFixed(3) + 's';
        const resStr = `${snap.width}x${snap.height}`;
        const statusClass = snap.imported ? 'status-imported' : 'status-local-only';
        const statusText = snap.imported ? '📥 Imported to CapCut' : '💾 Local Only';
        
        // Load preview through local Flask endpoint
        const previewUrl = `/api/snapshot/preview?path=${encodeURIComponent(snap.path)}`;
        
        let checkboxHtml = '';
        if (isSelectionMode) {
            checkboxHtml = `
                <div class="snap-checkbox-wrapper" onclick="event.stopPropagation();">
                    <input type="checkbox" class="snap-card-checkbox" data-path="${snap.path}" ${selectedSnapshotPaths.has(snap.path) ? 'checked' : ''}>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="snap-thumbnail-wrapper" ${isSelectionMode ? '' : `onclick="showPreviewModal('${snap.path.replace(/\\/g, '/')}', '${snap.filename}')"`} title="${isSelectionMode ? '' : 'Click to view full preview'}">
                ${checkboxHtml}
                <img class="snap-thumbnail" src="${previewUrl}" alt="Snapshot preview">
            </div>
            <div class="snap-info">
                <div class="snap-filename" title="${snap.filename}">${snap.filename}</div>
                <div class="snap-meta">Time: ${timestamp} | Res: ${resStr}</div>
                <div class="snap-status ${statusClass}">${statusText}</div>
            </div>
        `;
        
        // If selection mode, bind checkbox change event
        if (isSelectionMode) {
            const chk = card.querySelector('.snap-card-checkbox');
            chk.addEventListener('change', (ev) => {
                if (ev.target.checked) {
                    selectedSnapshotPaths.add(snap.path);
                    card.classList.add('selected');
                } else {
                    selectedSnapshotPaths.delete(snap.path);
                    card.classList.remove('selected');
                }
                updateDeleteButtonState();
            });
        }
        
        snapshotGallery.appendChild(card);
    });
}

function selectGalleryImage(idx) {
    selectedGalleryImage = captureGallery[idx];
    
    const cards = snapshotGallery.querySelectorAll('.snapshot-card');
    cards.forEach((c, cIdx) => {
        if (cIdx === idx) {
            c.classList.add('selected');
        } else {
            c.classList.remove('selected');
        }
    });
    
    appendLog(`Selected image for placement: "${selectedGalleryImage.filename}"`);
}

// --- Selection and Deletion of Gallery Snapshots ---
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    if (isSelectionMode) {
        btnToggleSelect.textContent = 'Cancel';
        btnToggleSelect.classList.add('btn-primary');
    } else {
        btnToggleSelect.textContent = 'Select';
        btnToggleSelect.classList.remove('btn-primary');
        selectedSnapshotPaths.clear();
        btnDeleteSelected.style.display = 'none';
    }
    renderGallery();
}

function updateDeleteButtonState() {
    if (selectedSnapshotPaths.size > 0) {
        btnDeleteSelected.style.display = 'inline-block';
        btnDeleteSelected.textContent = `Delete (${selectedSnapshotPaths.size})`;
    } else {
        btnDeleteSelected.style.display = 'none';
    }
}

async function deleteSelectedSnapshots() {
    if (selectedSnapshotPaths.size === 0) return;
    
    const confirmMsg = `Are you sure you want to delete ${selectedSnapshotPaths.size} selected snapshot(s) from your disk and gallery?`;
    if (!confirm(confirmMsg)) return;
    
    const pathsToDelete = Array.from(selectedSnapshotPaths);
    
    try {
        const response = await fetch('/api/snapshots/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: pathsToDelete })
        });
        const data = await response.json();
        
        if (data.success) {
            // Remove deleted items from captureGallery state
            const deletedSet = new Set(data.deleted || []);
            captureGallery = captureGallery.filter(snap => !deletedSet.has(snap.path));
            
            // Save to localStorage
            localStorage.setItem('capture_gallery', JSON.stringify(captureGallery));
            
            // Reset selection mode
            isSelectionMode = false;
            btnToggleSelect.textContent = 'Select';
            btnToggleSelect.classList.remove('btn-primary');
            selectedSnapshotPaths.clear();
            btnDeleteSelected.style.display = 'none';
            
            appendLog(`Deleted ${data.deleted.length} snapshots successfully.`);
            renderGallery();
        } else {
            appendLog(`Delete failed: ${data.error || 'Unknown error'}`, true);
        }
    } catch (err) {
        appendLog(`Error deleting snapshots: ${err.message}`, true);
    }
}

// --- Storyboard Editor (Align Images to Voice) Frontend ---

async function onStoryboardTimelineChange(e) {
    const timelineUuid = e.target.value;
    if (!timelineUuid) {
        selectedStoryboardTimeline = null;
        localStorage.removeItem('selected_storyboard_timeline');
        btnReloadStoryboard.disabled = true;
        storyboardTimeline.innerHTML = '<div class="empty-state">Select a project and a target timeline above to load the voice storyboard.</div>';
        return;
    }
    
    const selectedOpt = selectStoryboardTimeline.options[selectStoryboardTimeline.selectedIndex];
    selectedStoryboardTimeline = JSON.parse(selectedOpt.dataset.rawJson);
    localStorage.setItem('selected_storyboard_timeline', timelineUuid);
    btnReloadStoryboard.disabled = false;
    
    loadStoryboard();
}

async function loadStoryboard() {
    if (!selectedProject || !selectedStoryboardTimeline) return;
    
    storyboardTimeline.innerHTML = '<div class="loading-state">Loading voice storyboard timeline...</div>';
    
    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio = null;
        currentPlayingButton = null;
    }
    
    try {
        const response = await fetch(`/api/projects/${selectedProject.folder_name}/timelines/${selectedStoryboardTimeline.uuid}/storyboard`);
        const data = await response.json();
        
        if (data.error) {
            appendLog(`Failed to load storyboard: ${data.error}`, true);
            storyboardTimeline.innerHTML = `<div class="empty-state">Error: ${data.error}</div>`;
            return;
        }
        
        const storyboard = data.storyboard || [];
        renderStoryboard(storyboard);
    } catch (e) {
        appendLog(`Error loading storyboard: ${e.message}`, true);
        storyboardTimeline.innerHTML = `<div class="empty-state">Network error loading storyboard: ${e.message}</div>`;
    }
}

function renderStoryboard(storyboard) {
    if (storyboard.length === 0) {
        storyboardTimeline.innerHTML = '<div class="empty-state">No audio/voice segments found in the target timeline. Make sure you have audio clips on Track 1.</div>';
        return;
    }
    
    storyboardTimeline.innerHTML = '';
    storyboard.forEach((row, idx) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'storyboard-row';
        
        // DRAG AND DROP TARGET EVENTS
        rowDiv.addEventListener('dragover', (e) => {
            e.preventDefault();
            rowDiv.classList.add('drag-over');
        });
        
        rowDiv.addEventListener('dragleave', () => {
            rowDiv.classList.remove('drag-over');
        });
        
        rowDiv.addEventListener('drop', async (e) => {
            e.preventDefault();
            rowDiv.classList.remove('drag-over');
            
            try {
                const rawData = e.dataTransfer.getData('text/plain');
                if (!rawData) return;
                const dragData = JSON.parse(rawData);
                
                await assignDraggedImageToStoryboard(row.start, row.duration, dragData);
            } catch (err) {
                appendLog(`Drag drop assignment failed: ${err.message}`, true);
            }
        });
        
        const startMin = Math.floor(row.start / 60);
        const startSec = Math.floor(row.start % 60);
        const durStr = row.duration.toFixed(2) + 's';
        const timeStr = `${startMin}m ${startSec}s (dur: ${durStr})`;
        
        const bubbleText = row.text ? row.text : '<span class="empty">Not transcribed or silent segment</span>';
        
        let actionZoneHtml = '';
        if (row.assigned_clip) {
            const placedImgUrl = `/api/snapshot/preview?path=${encodeURIComponent(row.assigned_clip.path)}`;
            actionZoneHtml = `
                <div class="storyboard-placed-image">
                    <div class="placed-thumb-wrapper" onclick="showPreviewModal('${row.assigned_clip.path.replace(/\\/g, '/')}', '${row.assigned_clip.name}')" style="cursor:pointer; width:48px; height:27px; overflow:hidden; border-radius:3px; border:1px solid rgba(255,255,255,0.1);" title="Click to view full preview">
                        <img class="placed-thumb" src="${placedImgUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Placed image">
                    </div>
                    <div class="placed-details">
                        <div class="placed-filename" title="${row.assigned_clip.name}">${row.assigned_clip.name}</div>
                    </div>
                    <button class="btn-remove-placement" onclick="removeStoryboardPlacement('${row.assigned_clip.segment_id}')" title="Remove placement">×</button>
                </div>
            `;
        } else {
            actionZoneHtml = `
                <button class="btn btn-secondary btn-sm" style="width:100%;" onclick="assignImageToStoryboard(${row.start}, ${row.duration})">
                    ➕ Assign Image
                </button>
            `;
        }
        
        const listenBtnHtml = `
            <button class="btn btn-secondary btn-sm ctrl-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;" onclick="playAudioSegment('${row.audio_path}', ${row.source_start}, ${row.source_duration}, this)">
                🔊 Listen
            </button>
        `;
        
        const checkboxHtml = `
            <div class="storyboard-checkbox-col" style="flex-direction: column; gap: 4px; min-width: 45px;">
                <span style="font-size: 0.8rem; font-weight: 800; color: var(--accent-purple); margin-bottom: 2px;">#${idx + 1}</span>
                <input type="checkbox" class="storyboard-row-checkbox" data-start="${row.start}" data-end="${row.start + row.duration}" onclick="handleCheckboxClick(event)">
            </div>
        `;
        
        rowDiv.innerHTML = `
            ${checkboxHtml}
            <div class="storyboard-time">
                <div>${timeStr}</div>
                <div style="margin-top: 8px;">
                    ${row.audio_path ? listenBtnHtml : ''}
                </div>
            </div>
            <div class="storyboard-text-bubble">${bubbleText}</div>
            <div class="storyboard-action-zone">${actionZoneHtml}</div>
        `;
        storyboardTimeline.appendChild(rowDiv);
    });
}

// --- Audio Segment Playback (Listen to Voice Clips) ---

function playAudioSegment(path, startSec, durationSec, buttonEl) {
    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        if (currentPlayingButton) {
            currentPlayingButton.innerHTML = '🔊 Listen';
        }
        if (currentPlayingAudio.src_path === path && currentPlayingAudio.start_sec === startSec) {
            currentPlayingAudio = null;
            currentPlayingButton = null;
            return;
        }
    }
    
    const streamUrl = `/api/audio/stream?path=${encodeURIComponent(path)}`;
    const audio = new Audio(streamUrl);
    audio.src_path = path;
    audio.start_sec = startSec;
    audio.currentTime = startSec;
    
    currentPlayingAudio = audio;
    currentPlayingButton = buttonEl;
    
    buttonEl.innerHTML = '⏹ Stop';
    audio.play().catch(err => {
        appendLog(`Audio play failed: ${err.message}`, true);
        buttonEl.innerHTML = '🔊 Listen';
    });
    
    audio.addEventListener('timeupdate', () => {
        if (audio.currentTime >= startSec + durationSec) {
            audio.pause();
            buttonEl.innerHTML = '🔊 Listen';
            if (currentPlayingAudio === audio) {
                currentPlayingAudio = null;
                currentPlayingButton = null;
            }
        }
    });
    
    audio.addEventListener('ended', () => {
        buttonEl.innerHTML = '🔊 Listen';
        if (currentPlayingAudio === audio) {
            currentPlayingAudio = null;
            currentPlayingButton = null;
        }
    });
}

async function assignDraggedImageToStoryboard(startSec, durationSec, dragData) {
    await checkCapCutStatus();
    if (capcutStatusBadge.classList.contains('running')) {
        alert("CapCut is currently running! Please close CapCut to modify the timeline.");
        return;
    }
    
    // Check if there are checked checkboxes in the storyboard
    const checkedCheckboxes = Array.from(document.querySelectorAll('.storyboard-row-checkbox:checked'));
    let finalStart = startSec;
    let finalDuration = durationSec;
    
    if (checkedCheckboxes.length > 0) {
        const starts = checkedCheckboxes.map(cb => parseFloat(cb.dataset.start));
        const ends = checkedCheckboxes.map(cb => parseFloat(cb.dataset.end));
        finalStart = Math.min(...starts);
        const finalEnd = Math.max(...ends);
        finalDuration = finalEnd - finalStart;
    }
    
    appendLog(`Placing image "${dragData.filename}" on video timeline spanning ${finalStart.toFixed(2)}s to ${ (finalStart + finalDuration).toFixed(2) }s...`);
    
    try {
        const response = await fetch(`/api/projects/${selectedProject.folder_name}/timelines/${selectedStoryboardTimeline.uuid}/storyboard/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_path: dragData.path,
                image_material_id: dragData.material_id,
                start_sec: finalStart,
                duration_sec: finalDuration
            })
        });
        const data = await response.json();
        
        if (data.success) {
            appendLog(`Success: Placed image on timeline.`);
            // Uncheck all after successful assign
            checkedCheckboxes.forEach(cb => cb.checked = false);
            updateStoryboardSelectionHeader();
            loadStoryboard();
        } else {
            appendLog(`Placement failed: ${data.error}`, true);
        }
    } catch (e) {
        appendLog(`Error placing image: ${e.message}`, true);
    }
}

async function assignImageToStoryboard(startSec, durationSec) {
    if (!selectedGalleryImage) {
        alert("Please select a captured snapshot from the right 'Captured Snapshots' list first! (Or simply DRAG the card and DROP it onto the row!)");
        return;
    }
    await assignDraggedImageToStoryboard(startSec, durationSec, selectedGalleryImage);
}

async function removeStoryboardPlacement(segmentId) {
    await checkCapCutStatus();
    if (capcutStatusBadge.classList.contains('running')) {
        alert("CapCut is currently running! Please close CapCut to modify the timeline.");
        return;
    }
    
    if (!confirm("Are you sure you want to remove this image placement?")) return;
    
    try {
        const response = await fetch(`/api/projects/${selectedProject.folder_name}/timelines/${selectedStoryboardTimeline.uuid}/storyboard/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segment_id: segmentId })
        });
        const data = await response.json();
        
        if (data.success) {
            appendLog(`Removed image placement from timeline.`);
            loadStoryboard();
        } else {
            appendLog(`Failed to remove placement: ${data.error}`, true);
        }
    } catch (e) {
        appendLog(`Error removing placement: ${e.message}`, true);
    }
}

// --- Preview Modal ---
function showPreviewModal(path, filename) {
    const previewUrl = `/api/snapshot/preview?path=${encodeURIComponent(path)}`;
    imgModalPreview.src = previewUrl;
    modalCaption.innerHTML = `<strong>${filename}</strong><br><small style="color:var(--text-secondary);">${path}</small>`;
    previewModal.style.display = 'block';
}

function closePreview() {
    previewModal.style.display = 'none';
}

// --- Video Smooth Seeking (while playing) ---
let wasPlayingBeforeSeek = false;

function seekSmoothly(amount) {
    if (!videoPlayer.src) return;
    
    wasPlayingBeforeSeek = !videoPlayer.paused;
    if (wasPlayingBeforeSeek) {
        videoPlayer.pause();
    }
    
    let newTime = videoPlayer.currentTime + amount;
    newTime = Math.max(0.0, Math.min(videoPlayer.duration, newTime));
    
    const onSeeked = () => {
        videoPlayer.removeEventListener('seeked', onSeeked);
        if (wasPlayingBeforeSeek) {
            videoPlayer.play();
        }
    };
    videoPlayer.addEventListener('seeked', onSeeked);
    
    videoPlayer.currentTime = newTime;
}

// --- Global Key Handling (Capturing Phase) ---

function handleGlobalKeydown(e) {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
    }

    if (isBindingHotkey) {
        e.preventDefault();
        e.stopPropagation();
        const pressedKey = e.key.toLowerCase();
        
        if (pressedKey !== 'control' && pressedKey !== 'shift' && pressedKey !== 'alt' && pressedKey !== 'meta') {
            currentHotkey = pressedKey;
            localStorage.setItem('snapshot_hotkey', currentHotkey);
            labelCurrentHotkey.textContent = currentHotkey.toUpperCase();
            
            isBindingHotkey = false;
            btnBindHotkey.textContent = 'Press key to bind';
            btnBindHotkey.classList.remove('btn-primary');
            appendLog(`Shortcut hotkey bound to: "${currentHotkey.toUpperCase()}"`);
            blurActiveElement();
        }
        return;
    }

    // SPACEBAR: Play / Pause
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        togglePlayPause();
        blurActiveElement();
        return;
    }

    // ARROW RIGHT: Seek forward 2.0 seconds
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        seekSmoothly(2.0);
        return;
    }

    // ARROW LEFT: Seek backward 2.0 seconds
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        seekSmoothly(-2.0);
        return;
    }

    // PERIOD / COMMA: Precise Frame Stepping (1 frame = ~0.033s)
    const frameStep = 1.0 / 30.0;
    if (e.key === '.' || e.key === '>') {
        e.preventDefault();
        e.stopPropagation();
        if (videoPlayer.src) {
            videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + frameStep);
        }
        return;
    }
    if (e.key === ',' || e.key === '<') {
        e.preventDefault();
        e.stopPropagation();
        if (videoPlayer.src) {
            videoPlayer.currentTime = Math.max(0.0, videoPlayer.currentTime - frameStep);
        }
        return;
    }

    // CUSTOM SHORTCUT HOTKEY (Default 'S'): Capture frame
    if (e.key.toLowerCase() === currentHotkey) {
        e.preventDefault();
        e.stopPropagation();
        triggerCapture();
        return;
    }
}

// --- CapCut Process Checking ---

async function checkCapCutStatus() {
    try {
        const response = await fetch('/api/capcut/status');
        const data = await response.json();
        
        if (data.running) {
            capcutStatusBadge.className = 'status-badge running';
            capcutStatusBadge.querySelector('.status-text').textContent = '⚠️ CapCut: Open (Import Locked)';
            if (btnLaunchCapcut) {
                btnLaunchCapcut.disabled = true;
                btnLaunchCapcut.style.opacity = '0.5';
                btnLaunchCapcut.style.cursor = 'not-allowed';
            }
            if (btnKillCapcut) {
                btnKillCapcut.disabled = false;
                btnKillCapcut.style.opacity = '1.0';
                btnKillCapcut.style.cursor = 'pointer';
            }
        } else {
            capcutStatusBadge.className = 'status-badge closed';
            capcutStatusBadge.querySelector('.status-text').textContent = '✅ CapCut: Closed (Import Ready)';
            if (btnLaunchCapcut) {
                btnLaunchCapcut.disabled = false;
                btnLaunchCapcut.style.opacity = '1.0';
                btnLaunchCapcut.style.cursor = 'pointer';
            }
            if (btnKillCapcut) {
                btnKillCapcut.disabled = true;
                btnKillCapcut.style.opacity = '0.5';
                btnKillCapcut.style.cursor = 'not-allowed';
            }
        }
    } catch (e) {
        capcutStatusBadge.className = 'status-badge checking';
        capcutStatusBadge.querySelector('.status-text').textContent = 'Connection Error';
    }
}

async function launchCapCut() {
    appendLog("Launching CapCut...");
    try {
        const response = await fetch('/api/capcut/launch', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            appendLog("CapCut launch signal sent. Opening application...");
            setTimeout(checkCapCutStatus, 3000);
        } else {
            appendLog(`Launch failed: ${data.error || 'Unknown error'}`, true);
        }
    } catch (e) {
        appendLog(`Error launching CapCut: ${e.message}`, true);
    }
}

async function killCapCut() {
    appendLog("Sending shutdown request to CapCut...");
    try {
        const response = await fetch('/api/capcut/kill', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            appendLog("CapCut closed successfully.");
            checkCapCutStatus();
        } else {
            appendLog("Notice: CapCut processes not found or failed to close.", true);
        }
    } catch (e) {
        appendLog(`Error closing CapCut: ${e.message}`, true);
    }
}

// --- Console Log Helpers ---
function appendLog(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? '[ERROR]' : '[INFO]';
    const colorClass = isError ? 'color: var(--accent-red);' : '';
    
    consoleOutput.innerHTML += `\n<span style="${colorClass}">[${timestamp}] ${prefix} ${message}</span>`;
    const consoleBody = consoleOutput.parentElement;
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

function clearConsole() {
    consoleOutput.innerHTML = `> Console cleared. Ready.`;
}

// --- Storyboard Selection Helpers ---
let lastCheckedCheckbox = null;

function handleCheckboxClick(e) {
    const checkboxes = Array.from(document.querySelectorAll('.storyboard-row-checkbox'));
    const currentCheckbox = e.target;
    
    if (e.shiftKey && lastCheckedCheckbox) {
        let startIdx = checkboxes.indexOf(lastCheckedCheckbox);
        let endIdx = checkboxes.indexOf(currentCheckbox);
        
        let [minIdx, maxIdx] = [startIdx, endIdx].sort((a, b) => a - b);
        
        for (let i = minIdx; i <= maxIdx; i++) {
            checkboxes[i].checked = lastCheckedCheckbox.checked;
        }
    }
    
    lastCheckedCheckbox = currentCheckbox;
    updateStoryboardSelectionHeader();
}

function updateStoryboardSelectionHeader() {
    const checkedCheckboxes = Array.from(document.querySelectorAll('.storyboard-row-checkbox:checked'));
    const info = document.getElementById('storyboard-selection-info');
    
    if (checkedCheckboxes.length > 0) {
        const starts = checkedCheckboxes.map(cb => parseFloat(cb.dataset.start));
        const ends = checkedCheckboxes.map(cb => parseFloat(cb.dataset.end));
        const minStart = Math.min(...starts);
        const maxEnd = Math.max(...ends);
        const duration = maxEnd - minStart;
        
        info.textContent = `Selected: ${checkedCheckboxes.length} segments (Range: ${minStart.toFixed(2)}s to ${maxEnd.toFixed(2)}s, Total Duration: ${duration.toFixed(2)}s)`;
    } else {
        info.textContent = `No segments selected (Use checkboxes or Range selection)`;
    }
}

function clearStoryboardSelection() {
    const checkboxes = document.querySelectorAll('.storyboard-row-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    lastCheckedCheckbox = null;
    updateStoryboardSelectionHeader();
}

function selectRangeByIndices() {
    const startInput = document.getElementById('input-range-start');
    const endInput = document.getElementById('input-range-end');
    
    const startIdx = parseInt(startInput.value);
    const endIdx = parseInt(endInput.value);
    
    if (isNaN(startIdx) || isNaN(endIdx)) {
        alert("Please enter both Start and End sequence numbers (e.g. 1 to 5).");
        return;
    }
    
    const checkboxes = Array.from(document.querySelectorAll('.storyboard-row-checkbox'));
    if (checkboxes.length === 0) return;
    
    const [min, max] = [startIdx, endIdx].sort((a, b) => a - b);
    
    checkboxes.forEach((cb, idx) => {
        const num = idx + 1;
        cb.checked = (num >= min && num <= max);
    });
    
    updateStoryboardSelectionHeader();
}

// Export functions to global scope for HTML onclick bindings
window.launchCapCut = launchCapCut;
window.killCapCut = killCapCut;
window.clearStoryboardSelection = clearStoryboardSelection;
window.handleCheckboxClick = handleCheckboxClick;
window.selectRangeByIndices = selectRangeByIndices;
