import os
import json
import sys
import subprocess
import uuid
import psutil
import threading
import hashlib
import shutil
from flask import Flask, jsonify, request, send_file, render_template, Response
from flask_cors import CORS

# Load .env manually if it exists
if os.path.exists('.env'):
    try:
        with open('.env', 'r', encoding='utf-8') as env_f:
            for line in env_f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ[k.strip()] = v.strip()
    except Exception as e:
        print("Error reading .env:", e)

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

CAPCUT_DRAFTS_DIR = os.path.join(os.environ['LOCALAPPDATA'], 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')
TRANSCODE_DIR = os.path.join(os.environ['TEMP'], 'capcut_snapshot_transcodes')
os.makedirs(TRANSCODE_DIR, exist_ok=True)

# Track transcoding status globally
transcode_status = {}

def find_latest_ffmpeg():
    local_appdata = os.path.expandvars('%LOCALAPPDATA%')
    capcut_apps_path = os.path.join(local_appdata, 'CapCut', 'Apps')
    if not os.path.exists(capcut_apps_path):
        return None
    versions = []
    for d in os.listdir(capcut_apps_path):
        dp = os.path.join(capcut_apps_path, d)
        ffmpeg_file = os.path.join(dp, 'ffmpeg.exe')
        if os.path.isdir(dp) and os.path.exists(ffmpeg_file):
            versions.append((d, ffmpeg_file))
    if not versions:
        return None
    versions.sort(key=lambda x: [int(num) for num in x[0].split('.') if num.isdigit()])
    return versions[-1][1]

def is_capcut_running():
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] and 'capcut' in proc.info['name'].lower():
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return False

def kill_capcut_processes():
    killed = False
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            if proc.info['name'] and 'capcut' in proc.info['name'].lower():
                proc.kill()
                killed = True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return killed

def get_proxy_path(video_path):
    h = hashlib.md5(video_path.encode('utf-8')).hexdigest()
    return os.path.normpath(os.path.join(TRANSCODE_DIR, f"proxy_{h}.mp4")).replace('\\', '/')

def transcode_worker(video_path, proxy_path):
    ffmpeg_path = find_latest_ffmpeg()
    if not ffmpeg_path:
        transcode_status[video_path] = "failed"
        return
        
    cmd = [
        ffmpeg_path,
        '-y',
        '-i', video_path,
        '-c:v', 'copy',
        '-c:a', 'copy',
        proxy_path
    ]
    
    transcode_status[video_path] = "processing"
    
    creationflags = 0
    if sys.platform == 'win32':
        creationflags = subprocess.CREATE_NO_WINDOW
        
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
    if res.returncode == 0 and os.path.exists(proxy_path):
        transcode_status[video_path] = "ready"
    else:
        transcode_status[video_path] = "failed"

# --- Flask Routes ---
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/projects', methods=['GET'])
def get_projects():
    meta_path = os.path.join(CAPCUT_DRAFTS_DIR, 'root_meta_info.json')
    if not os.path.exists(meta_path):
        return jsonify({"projects": []})
        
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta_data = json.load(f)
    except Exception as e:
        return jsonify({"error": f"Failed to read root_meta_info.json: {str(e)}"}), 500
        
    projects = []
    for draft in meta_data.get('all_draft_store', []):
        folder_path = draft.get('draft_fold_path', '')
        folder_name = os.path.basename(folder_path)
        
        # Verify folder exists on disk
        if not os.path.exists(folder_path):
            continue
            
        projects.append({
            "id": draft.get('draft_id'),
            "name": draft.get('draft_name'),
            "folder_name": folder_name,
            "duration": draft.get('tm_duration', 0) / 1000000.0,
            "size": draft.get('draft_timeline_materials_size', 0),
            "created": draft.get('tm_draft_create', 0) / 1000000.0,
            "modified": draft.get('tm_draft_modified', 0) / 1000000.0
        })
        
    projects.sort(key=lambda x: x['modified'], reverse=True)
    return jsonify({"projects": projects})

@app.route('/api/projects/<name>/timelines', methods=['GET'])
def get_timelines(name):
    name_clean = os.path.basename(name)
    project_path = os.path.join(CAPCUT_DRAFTS_DIR, name_clean)
    timelines_dir = os.path.join(project_path, 'Timelines')
    
    if not os.path.exists(timelines_dir):
        # Fallback if no sub-timelines, use root draft
        draft_path = os.path.join(project_path, 'draft_content.json')
        if os.path.exists(draft_path):
            return jsonify({"timelines": [{
                "uuid": "root",
                "name": "Main Timeline",
                "segments_count": 0,
                "duration": 0
            }]})
        return jsonify({"timelines": []})
        
    project_json_path = os.path.join(timelines_dir, 'project.json')
    timelines_meta = []
    if os.path.exists(project_json_path):
        try:
            with open(project_json_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            timelines_meta = meta.get('timelines', [])
        except Exception:
            pass
            
    timelines = []
    for t_folder in os.listdir(timelines_dir):
        t_path = os.path.join(timelines_dir, t_folder)
        if not os.path.isdir(t_path):
            continue
            
        draft_content_path = os.path.join(t_path, 'draft_content.json')
        if not os.path.exists(draft_content_path):
            continue
            
        timeline_name = f"Timeline {t_folder[:8]}"
        for t_meta in timelines_meta:
            if t_meta.get('id') == t_folder:
                timeline_name = t_meta.get('name')
                break
                
        segment_count = 0
        duration_sec = 0.0
        try:
            with open(draft_content_path, 'r', encoding='utf-8') as df:
                d_content = json.load(df)
            tracks = d_content.get('tracks', [])
            if tracks:
                for track in tracks:
                    segs = track.get('segments', [])
                    segment_count += len(segs)
                    for seg in segs:
                        end_t = (seg['target_timerange']['start'] + seg['target_timerange']['duration']) / 1000000.0
                        if end_t > duration_sec:
                            duration_sec = end_t
        except Exception:
            pass
            
        timelines.append({
            "uuid": t_folder,
            "name": timeline_name,
            "segments_count": segment_count,
            "duration": duration_sec
        })
        
    return jsonify({"timelines": timelines})

@app.route('/api/projects/<name>/timelines/<uuid>/videos', methods=['GET'])
def get_timeline_videos(name, uuid):
    name_clean = os.path.basename(name)
    project_path = os.path.join(CAPCUT_DRAFTS_DIR, name_clean)
    
    if uuid == "root":
        draft_path = os.path.join(project_path, 'draft_content.json')
    else:
        draft_path = os.path.join(project_path, 'Timelines', uuid, 'draft_content.json')
        
    if not os.path.exists(draft_path):
        return jsonify({"error": "Timeline draft_content.json not found"}), 404
        
    try:
        with open(draft_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    materials = data.get('materials', {})
    videos_list = materials.get('videos', [])
    
    unique_videos = []
    seen_paths = set()
    video_extensions = {'.mp4', '.ts', '.mov', '.mkv', '.avi', '.webm', '.flv', '.m4v', '.mpg', '.mpeg'}
    
    for v in videos_list:
        v_id = v.get('id')
        path_placeholder = v.get('path') or v.get('local_path')
        if not path_placeholder:
            continue
            
        resolved_path = path_placeholder
        if '##_draftpath_placeholder_' in path_placeholder:
            parts = path_placeholder.split('_##/')
            if len(parts) == 2:
                resolved_path = os.path.join(project_path, parts[1])
                
        resolved_path = os.path.normpath(resolved_path).replace('\\', '/')
        
        if resolved_path in seen_paths:
            continue
            
        ext = os.path.splitext(resolved_path.lower())[1]
        if ext not in video_extensions:
            continue
            
        if os.path.exists(resolved_path):
            seen_paths.add(resolved_path)
            unique_videos.append({
                "id": v_id,
                "name": v.get('material_name') or os.path.basename(resolved_path),
                "path": resolved_path,
                "duration": v.get('duration', 0) / 1000000.0,
                "width": v.get('width', 1920),
                "height": v.get('height', 1080)
            })
            
    return jsonify({"videos": unique_videos})

# --- Transcoding and Streaming ---

@app.route('/api/video/transcode', methods=['POST'])
def check_or_start_transcode():
    req = request.json or {}
    video_path = req.get('video_path')
    
    if not video_path or not os.path.exists(video_path):
        return jsonify({"status": "failed", "error": "Video file not found."}), 404
        
    if video_path.lower().endswith('.mp4'):
        return jsonify({"status": "ready"})
        
    proxy_path = get_proxy_path(video_path)
    if os.path.exists(proxy_path):
        return jsonify({"status": "ready"})
        
    status = transcode_status.get(video_path)
    if status == "processing":
        return jsonify({"status": "processing"})
        
    # Start background transcode
    t = threading.Thread(target=transcode_worker, args=(video_path, proxy_path))
    t.daemon = True
    t.start()
    
    return jsonify({"status": "started"})

@app.route('/api/video/transcode_status', methods=['GET'])
def get_transcode_status():
    video_path = request.args.get('path')
    if not video_path:
        return jsonify({"status": "failed"}), 400
        
    if video_path.lower().endswith('.mp4'):
        return jsonify({"status": "ready"})
        
    proxy_path = get_proxy_path(video_path)
    if os.path.exists(proxy_path):
        return jsonify({"status": "ready"})
        
    status = transcode_status.get(video_path, "not_started")
    return jsonify({"status": status})

@app.route('/api/video/stream')
def stream_video():
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return "File not found", 404
        
    # If not MP4, check for transcoded proxy
    if not path.lower().endswith('.mp4'):
        proxy = get_proxy_path(path)
        if os.path.exists(proxy):
            path = proxy
        else:
            return "Video proxy is still transcoding. Please wait.", 202
            
    file_size = os.path.getsize(path)
    range_header = request.headers.get('Range', None)
    
    if not range_header:
        def generate():
            with open(path, 'rb') as f:
                while True:
                    chunk = f.read(819200)
                    if not chunk:
                        break
                    yield chunk
        return Response(generate(), mimetype='video/mp4', headers={'Content-Length': str(file_size)})
        
    byte_range = range_header.replace('bytes=', '').split('-')
    start = int(byte_range[0])
    end = int(byte_range[1]) if byte_range[1] else file_size - 1
    length = end - start + 1
    
    def generate_range():
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk_size = min(819200, remaining)
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
                
    headers = {
        'Content-Range': f'bytes {start}-{end}/{file_size}',
        'Accept-Ranges': 'bytes',
        'Content-Length': str(length)
    }
    return Response(generate_range(), status=206, mimetype='video/mp4', headers=headers)

@app.route('/api/audio/stream')
def stream_audio():
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return "File not found", 404
        
    file_size = os.path.getsize(path)
    range_header = request.headers.get('Range', None)
    
    mimetype = 'audio/aac'
    if path.lower().endswith('.wav'):
        mimetype = 'audio/wav'
    elif path.lower().endswith('.m4a') or path.lower().endswith('.mp4'):
        mimetype = 'audio/mp4'
        
    if not range_header:
        def generate():
            with open(path, 'rb') as f:
                while True:
                    chunk = f.read(819200)
                    if not chunk:
                        break
                    yield chunk
        return Response(generate(), mimetype=mimetype, headers={'Content-Length': str(file_size)})
        
    byte_range = range_header.replace('bytes=', '').split('-')
    start = int(byte_range[0])
    end = int(byte_range[1]) if byte_range[1] else file_size - 1
    length = end - start + 1
    
    def generate_range():
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk_size = min(819200, remaining)
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
                
    headers = {
        'Content-Range': f'bytes {start}-{end}/{file_size}',
        'Accept-Ranges': 'bytes',
        'Content-Length': str(length)
    }
    return Response(generate_range(), status=206, mimetype=mimetype, headers=headers)

# --- Snapshot Preview API ---
@app.route('/api/snapshot/preview')
def get_snapshot_preview():
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return "File not found", 404
        
    mimetype = 'image/png'
    if path.lower().endswith('.jpg') or path.lower().endswith('.jpeg'):
        mimetype = 'image/jpeg'
        
    return send_file(path, mimetype=mimetype)

@app.route('/api/video/capture', methods=['POST'])
def capture_frame():
    req = request.json or {}
    video_path = req.get('video_path')
    timestamp_sec = float(req.get('timestamp_sec', 0.0))
    output_dir = req.get('output_dir')
    resolution = req.get('resolution', 'original')
    img_format = req.get('format', 'png').lower()
    
    project_name = req.get('project_name')
    timeline_uuid = req.get('timeline_uuid')
    
    if not video_path or not os.path.exists(video_path):
        return jsonify({"success": False, "error": "Video file not found."}), 404
        
    if not output_dir:
        output_dir = os.path.join(os.environ['USERPROFILE'], 'Pictures', 'CapCut_Snapshots')
        
    os.makedirs(output_dir, exist_ok=True)
    
    # Check FFmpeg
    ffmpeg_path = find_latest_ffmpeg()
    if not ffmpeg_path:
        return jsonify({"success": False, "error": "ffmpeg.exe not found in CapCut Apps directory."}), 500
        
    # Construct output filename
    base_name = os.path.splitext(os.path.basename(video_path))[0]
    time_str = f"{int(timestamp_sec // 3600):02d}_{int((timestamp_sec % 3600) // 60):02d}_{int(timestamp_sec % 60):02d}_{int((timestamp_sec * 1000) % 1000):03d}"
    out_filename = f"{base_name}_frame_{time_str}.{img_format}"
    out_path = os.path.normpath(os.path.join(output_dir, out_filename)).replace('\\', '/')
    
    # Combined Seeking: Fast input seek first, then precise decode seek
    fast_ss = max(0.0, timestamp_sec - 15.0)
    rem_ss = timestamp_sec - fast_ss
    
    cmd = [
        ffmpeg_path,
        '-y',
        '-ss', f"{fast_ss:.3f}",
        '-i', video_path,
        '-ss', f"{rem_ss:.3f}"
    ]
    
    filters = []
    width, height = 1920, 1080
    if resolution == '1080p':
        filters.append('scale=1920:1080')
        width, height = 1920, 1080
    elif resolution == '720p':
        filters.append('scale=1280:720')
        width, height = 1280, 720
    else:
        width, height = int(req.get('video_width', 1920)), int(req.get('video_height', 1080))
        
    # Detail Enhancement filters (CAS / Unsharp)
    enhancement = req.get('enhancement', 'none')
    if enhancement == 'cas':
        filters.append('cas=strength=0.8')
    elif enhancement == 'unsharp':
        filters.append('unsharp=5:5:1.0:5:5:0.0')
    elif enhancement == 'super':
        filters.append('cas=strength=0.6,unsharp=5:5:0.5:5:5:0.0')
        
    if filters:
        cmd.extend(['-vf', ','.join(filters)])
        
    cmd.extend(['-vframes', '1', '-q:v', '2', out_path])
    
    creationflags = 0
    if sys.platform == 'win32':
        # Suppress black Command Prompt window popping up
        creationflags = subprocess.CREATE_NO_WINDOW
        
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
    if res.returncode != 0 or not os.path.exists(out_path):
        return jsonify({"success": False, "error": f"FFmpeg extraction failed: {res.stderr}"}), 500
        
    imported = False
    import_error = None
    new_material_id = None
    
    # Programmatic Database Import
    if project_name and timeline_uuid:
        if is_capcut_running():
            import_error = "CapCut is running! Frame saved to folder, but database import was skipped. Please close CapCut and try again."
        else:
            project_path = os.path.normpath(os.path.join(CAPCUT_DRAFTS_DIR, project_name))
            if timeline_uuid == "root":
                draft_path = os.path.join(project_path, 'draft_content.json')
            else:
                draft_path = os.path.join(project_path, 'Timelines', timeline_uuid, 'draft_content.json')
                
            if os.path.exists(draft_path):
                try:
                    # Backup draft first
                    shutil.copy2(draft_path, draft_path + f".before_capture_{uuid.uuid4().hex[:6]}_bak")
                    
                    with open(draft_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        
                    materials = data.setdefault('materials', {})
                    videos_list = materials.setdefault('videos', [])
                    
                    new_material_id = str(uuid.uuid4()).upper()
                    local_mat_id = str(uuid.uuid4()).lower()
                    
                    new_material = {
                        "id": new_material_id,
                        "unique_id": "",
                        "type": "video",
                        "duration": 3000000,
                        "path": out_path,
                        "media_path": "",
                        "local_id": "",
                        "has_audio": False,
                        "reverse_path": "",
                        "intensifies_path": "",
                        "reverse_intensifies_path": "",
                        "intensifies_audio_path": "",
                        "cartoon_path": "",
                        "width": width,
                        "height": height,
                        "category_id": "",
                        "category_name": "local",
                        "material_id": "",
                        "material_name": out_filename,
                        "material_url": "",
                        "crop": {
                            "upper_left_x": 0.0,
                            "upper_left_y": 0.0,
                            "upper_right_x": 1.0,
                            "upper_right_y": 0.0,
                            "lower_left_x": 0.0,
                            "lower_left_y": 1.0,
                            "lower_right_x": 1.0,
                            "lower_right_y": 1.0
                        },
                        "crop_ratio": "free",
                        "crop_scale": 1.0,
                        "extra_type_option": 0,
                        "source": 0,
                        "source_platform": 0,
                        "formula_id": "",
                        "check_flag": 62978047,
                        "local_material_id": local_mat_id,
                        "origin_material_id": "",
                        "request_id": "",
                        "has_sound_separated": False,
                        "is_text_edit_overdub": False,
                        "is_ai_generate_content": False,
                        "aigc_type": "none",
                        "is_copyright": False,
                        "aigc_history_id": "",
                        "aigc_item_id": "",
                        "local_material_from": "",
                        "picture_from": "none"
                    }
                    
                    videos_list.append(new_material)
                    
                    with open(draft_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2)
                    imported = True
                except Exception as e:
                    import_error = f"Database injection failed: {str(e)}"
            else:
                import_error = f"Timeline file not found: {draft_path}"
                
    return jsonify({
        "success": True,
        "filename": out_filename,
        "filepath": out_path,
        "width": width,
        "height": height,
        "imported": imported,
        "material_id": new_material_id,
        "import_error": import_error
    })

# --- Storyboard Alignment API ---

@app.route('/api/projects/<name>/timelines/<uuid>/storyboard', methods=['GET'])
def get_storyboard(name, uuid):
    name_clean = os.path.basename(name)
    project_path = os.path.join(CAPCUT_DRAFTS_DIR, name_clean)
    
    if uuid == "root":
        draft_path = os.path.join(project_path, 'draft_content.json')
        cache_path = os.path.join(project_path, 'transcription_cache.json')
    else:
        draft_path = os.path.join(project_path, 'Timelines', uuid, 'draft_content.json')
        cache_path = os.path.join(project_path, 'Timelines', uuid, 'transcription_cache.json')
        
    if not os.path.exists(draft_path):
        return jsonify({"error": "Timeline draft_content.json not found"}), 404
        
    try:
        with open(draft_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    transcriptions = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as cf:
                transcriptions = json.load(cf)
        except Exception:
            pass
            
    tracks = data.get('tracks', [])
    video_track = None
    audio_track = None
    
    for t in tracks:
        if t.get('type') == 'video':
            video_track = t
        elif t.get('type') == 'audio':
            audio_track = t
            
    audio_segments = []
    if audio_track:
        audio_segments = audio_track.get('segments', [])
    audio_segments.sort(key=lambda x: x['target_timerange']['start'])
    
    video_segments = []
    if video_track:
        video_segments = video_track.get('segments', [])
        
    materials = data.get('materials', {})
    videos_mat_list = materials.get('videos', [])
    
    storyboard = []
    for aud in audio_segments:
        aud_id = aud['id']
        aud_start = aud['target_timerange']['start']
        aud_dur = aud['target_timerange']['duration']
        aud_end = aud_start + aud_dur
        
        # Resolve transcription text
        mat_id = aud.get('material_id')
        src_start = aud['source_timerange']['start']
        src_dur = aud['source_timerange']['duration']
        cache_key = f"{mat_id}_{src_start}_{src_dur}"
        text = transcriptions.get(cache_key, "")
        
        # Resolve audio source path
        aud_path = ""
        for m_type in ['audios', 'videos']:
            if m_type in materials:
                for m in materials[m_type]:
                    if m.get('id') == mat_id:
                        aud_path = m.get('path') or m.get('local_path') or ""
                        break
                if aud_path:
                    break
                    
        if '##_draftpath_placeholder_' in aud_path:
            parts = aud_path.split('_##/')
            if len(parts) == 2:
                aud_path = os.path.join(project_path, parts[1])
        aud_path = os.path.normpath(aud_path).replace('\\', '/')
        
        # Check if there is an image placed on the video track covering this time position
        assigned_clip = None
        for vid in video_segments:
            v_start = vid['target_timerange']['start']
            v_dur = vid['target_timerange']['duration']
            v_end = v_start + v_dur
            
            # Check overlap
            if not (v_end <= aud_start or v_start >= aud_end):
                v_mat_id = vid.get('material_id')
                img_path = ""
                img_name = ""
                for m in videos_mat_list:
                    if m.get('id') == v_mat_id:
                        img_path = m.get('path') or m.get('local_path') or ""
                        img_name = m.get('material_name') or os.path.basename(img_path)
                        break
                assigned_clip = {
                    "segment_id": vid['id'],
                    "material_id": v_mat_id,
                    "path": img_path,
                    "name": img_name,
                    "start": v_start / 1000000.0,
                    "duration": v_dur / 1000000.0
                }
                break
                
        storyboard.append({
            "audio_id": aud_id,
            "audio_path": aud_path,
            "start": aud_start / 1000000.0,
            "duration": aud_dur / 1000000.0,
            "source_start": src_start / 1000000.0,
            "source_duration": src_dur / 1000000.0,
            "text": text,
            "assigned_clip": assigned_clip
        })
        
    return jsonify({"storyboard": storyboard})

@app.route('/api/projects/<name>/timelines/<timeline_uuid>/storyboard/assign', methods=['POST'])
def storyboard_assign_image(name, timeline_uuid):
    req = request.json or {}
    image_path = req.get('image_path')
    image_material_id = req.get('image_material_id')
    start_us = int(float(req.get('start_sec', 0.0)) * 1000000)
    duration_us = int(float(req.get('duration_sec', 3.0)) * 1000000)
    
    if is_capcut_running():
        return jsonify({"success": False, "error": "CapCut is running! Please close CapCut to modify the timeline."}), 400
        
    name_clean = os.path.basename(name)
    project_path = os.path.normpath(os.path.join(CAPCUT_DRAFTS_DIR, name_clean))
    
    if timeline_uuid == "root":
        draft_path = os.path.join(project_path, 'draft_content.json')
    else:
        draft_path = os.path.join(project_path, 'Timelines', timeline_uuid, 'draft_content.json')
        
    if not os.path.exists(draft_path):
        return jsonify({"success": False, "error": "Timeline file not found."}), 404
        
    try:
        shutil.copy2(draft_path, draft_path + f".before_assign_{uuid.uuid4().hex[:6]}_bak")
        
        with open(draft_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        materials = data.setdefault('materials', {})
        videos_list = materials.setdefault('videos', [])
        
        # Check if the material actually exists in this timeline's videos list
        exists = False
        mat_id = image_material_id
        if mat_id:
            for m in videos_list:
                if m.get('id') == mat_id:
                    exists = True
                    break
                    
        # If not found by ID, search by path in this timeline
        if not exists:
            for m in videos_list:
                if m.get('path') == image_path:
                    exists = True
                    mat_id = m.get('id')
                    break
                    
        # If it still doesn't exist anywhere in this timeline, import it!
        if not exists:
            mat_id = str(uuid.uuid4()).upper()
            local_mat_id = str(uuid.uuid4()).lower()
            new_material = {
                "id": mat_id,
                "unique_id": "",
                "type": "video",
                "duration": 3000000,
                "path": image_path,
                "media_path": "",
                "local_id": "",
                "has_audio": False,
                "reverse_path": "",
                "intensifies_path": "",
                "reverse_intensifies_path": "",
                "intensifies_audio_path": "",
                "cartoon_path": "",
                "width": 1920,
                "height": 1080,
                "category_id": "",
                "category_name": "local",
                "material_id": "",
                "material_name": os.path.basename(image_path),
                "material_url": "",
                "crop": {
                    "upper_left_x": 0.0,
                    "upper_left_y": 0.0,
                    "upper_right_x": 1.0,
                    "upper_right_y": 0.0,
                    "lower_left_x": 0.0,
                    "lower_left_y": 1.0,
                    "lower_right_x": 1.0,
                    "lower_right_y": 1.0
                },
                "crop_ratio": "free",
                "crop_scale": 1.0,
                "extra_type_option": 0,
                "source": 0,
                "source_platform": 0,
                "formula_id": "",
                "check_flag": 62978047,
                "local_material_id": local_mat_id,
                "origin_material_id": "",
                "request_id": "",
                "has_sound_separated": False,
                "is_text_edit_overdub": False,
                "is_ai_generate_content": False,
                "aigc_type": "none",
                "is_copyright": False,
                "aigc_history_id": "",
                "aigc_item_id": "",
                "local_material_from": "",
                "picture_from": "none"
            }
            videos_list.append(new_material)
            
        tracks = data.setdefault('tracks', [])
        video_track = None
        for t in tracks:
            if t.get('type') == 'video':
                video_track = t
                break
                
        if not video_track:
            video_track = {
                "id": str(uuid.uuid4()).upper(),
                "type": "video",
                "segments": []
            }
            tracks.insert(0, video_track)
            
        video_segments = video_track.setdefault('segments', [])
        
        end_us = start_us + duration_us
        # Keep only segments that do not overlap with the new range [start_us, end_us)
        video_segments = [
            v for v in video_segments 
            if (v['target_timerange']['start'] + v['target_timerange']['duration'] <= start_us or 
                v['target_timerange']['start'] >= end_us)
        ]
        video_track['segments'] = video_segments
        
        new_segment = {
            "id": str(uuid.uuid4()).upper(),
            "source_timerange": {
                "start": 0,
                "duration": duration_us
            },
            "target_timerange": {
                "start": start_us,
                "duration": duration_us
            },
            "render_timerange": {
                "start": 0,
                "duration": 0
            },
            "desc": "",
            "state": 0,
            "speed": 1.0,
            "is_loop": False,
            "is_tone_modify": False,
            "reverse": False,
            "intensifies_audio": False,
            "cartoon": False,
            "volume": 1.0,
            "last_nonzero_volume": 1.0,
            "clip": {
                "scale": {
                    "x": 1.0,
                    "y": 1.0
                },
                "rotation": 0.0,
                "transform": {
                    "x": 0.0,
                    "y": 0.0
                },
                "flip": {
                    "vertical": False,
                    "horizontal": False
                },
                "alpha": 1.0
            },
            "uniform_scale": {
                "on": True,
                "value": 1.0
            },
            "material_id": mat_id,
            "extra_material_refs": [],
            "render_index": 0,
            "keyframe_refs": [],
            "enable_lut": True,
            "enable_adjust": True,
            "enable_hsl": False,
            "visible": True,
            "group_id": "",
            "enable_color_curves": True,
            "enable_hsl_curves": True,
            "track_render_index": 0,
            "hdr_settings": {
                "mode": 1,
                "intensity": 1.0,
                "nits": 1000
            },
            "enable_color_wheels": True,
            "track_attribute": 0,
            "is_placeholder": False,
            "template_id": "",
            "enable_smart_color_adjust": False,
            "template_scene": "default",
            "common_keyframes": [],
            "caption_info": None,
            "responsive_layout": {
                "enable": False,
                "target_follow": "",
                "size_layout": 0,
                "horizontal_pos_layout": 0,
                "vertical_pos_layout": 0
            },
            "enable_color_match_adjust": False,
            "enable_color_correct_adjust": False,
            "enable_adjust_mask": False,
            "raw_segment_id": "",
            "lyric_keyframes": None,
            "enable_video_mask": True,
            "digital_human_template_group_id": "",
            "color_correct_alg_result": "",
            "source": "segmentsourcenormal",
            "enable_mask_stroke": False,
            "enable_mask_shadow": False,
            "enable_color_adjust_pro": False
        }
        
        video_segments.append(new_segment)
        video_segments.sort(key=lambda x: x['target_timerange']['start'])
        
        with open(draft_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            
        return jsonify({"success": True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/projects/<name>/timelines/<timeline_uuid>/storyboard/remove', methods=['POST'])
def storyboard_remove_image(name, timeline_uuid):
    req = request.json or {}
    segment_id = req.get('segment_id')
    
    if is_capcut_running():
        return jsonify({"success": False, "error": "CapCut is running! Please close CapCut to modify the timeline."}), 400
        
    name_clean = os.path.basename(name)
    project_path = os.path.normpath(os.path.join(CAPCUT_DRAFTS_DIR, name_clean))
    
    if timeline_uuid == "root":
        draft_path = os.path.join(project_path, 'draft_content.json')
    else:
        draft_path = os.path.join(project_path, 'Timelines', timeline_uuid, 'draft_content.json')
        
    if not os.path.exists(draft_path):
        return jsonify({"success": False, "error": "Timeline file not found."}), 404
        
    try:
        shutil.copy2(draft_path, draft_path + f".before_remove_{uuid.uuid4().hex[:6]}_bak")
        
        with open(draft_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        tracks = data.setdefault('tracks', [])
        video_track = None
        for t in tracks:
            if t.get('type') == 'video':
                video_track = t
                break
                
        if video_track:
            video_segments = video_track.get('segments', [])
            video_segments = [v for v in video_segments if v['id'] != segment_id]
            video_track['segments'] = video_segments
            
            with open(draft_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
                
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/capcut/status', methods=['GET'])
def get_capcut_status():
    return jsonify({"running": is_capcut_running()})

@app.route('/api/capcut/kill', methods=['POST'])
def kill_capcut():
    success = kill_capcut_processes()
    return jsonify({"success": success})

@app.route('/api/capcut/launch', methods=['POST'])
def launch_capcut():
    if is_capcut_running():
        return jsonify({"success": True, "message": "CapCut is already running"})
        
    local_appdata = os.path.expandvars('%LOCALAPPDATA%')
    capcut_apps_path = os.path.join(local_appdata, 'CapCut', 'Apps')
    if not os.path.exists(capcut_apps_path):
        return jsonify({"success": False, "error": "CapCut Apps directory not found"}), 404
        
    versions = [d for d in os.listdir(capcut_apps_path) if os.path.isdir(os.path.join(capcut_apps_path, d))]
    if not versions:
        return jsonify({"success": False, "error": "No CapCut version installed"}), 404
        
    versions.sort(key=lambda x: [int(num) for num in x.split('.') if num.isdigit()])
    capcut_exe = os.path.join(capcut_apps_path, versions[-1], 'CapCut.exe')
    
    if os.path.exists(capcut_exe):
        try:
            # Launch CapCut as a completely detached GUI process
            subprocess.Popen([capcut_exe], creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"success": False, "error": f"Failed to start CapCut: {str(e)}"}), 500
    else:
        return jsonify({"success": False, "error": f"CapCut.exe not found at {capcut_exe}"}), 404

@app.route('/api/snapshots/delete', methods=['POST'])
def delete_snapshots():
    req = request.json or {}
    paths = req.get('paths', [])
    deleted = []
    failed = []
    
    for path in paths:
        path = os.path.normpath(path).replace('\\', '/')
        if os.path.exists(path):
            try:
                os.remove(path)
                deleted.append(path)
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
        else:
            failed.append({"path": path, "error": "File not found"})
            
    return jsonify({"success": True, "deleted": deleted, "failed": failed})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001, debug=False)
