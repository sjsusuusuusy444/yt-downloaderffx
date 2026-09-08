// ============================================
// YT Downloader - Client-side JavaScript
// ============================================

// Create floating particles
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDuration = (Math.random() * 15 + 10) + 's';
    particle.style.animationDelay = (Math.random() * 10) + 's';
    particle.style.width = (Math.random() * 3 + 1) + 'px';
    particle.style.height = particle.style.width;
    container.appendChild(particle);
  }
}

// Initialize particles on load
document.addEventListener('DOMContentLoaded', createParticles);

// Set URL from example
function setUrl(url) {
  document.getElementById('urlInput').value = url;
  document.getElementById('urlInput').focus();
}

// Handle Enter key
document.getElementById('urlInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') fetchVideoInfo();
});

// Show error message
function showError(message) {
  const errorMsg = document.getElementById('errorMsg');
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorMsg.style.display = 'flex';
  
  // Auto hide after 8s
  setTimeout(() => {
    errorMsg.style.display = 'none';
  }, 8000);
}

// Hide error
function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

// Format file size
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// Format view count
function formatViews(count) {
  if (!count) return 'N/A';
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M views';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K views';
  return count + ' views';
}

// Format duration
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get quality badge
function getQualityBadge(height) {
  if (height >= 1080) return '<span class="format-badge hd">HD</span>';
  if (height >= 720) return '<span class="format-badge hd">HD</span>';
  return '<span class="format-badge sd">SD</span>';
}

// Store current video URL
let currentVideoUrl = '';

// Fetch video info
async function fetchVideoInfo() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) {
    showError('দয়া করে একটি YouTube ভিডিও লিংক দিন');
    return;
  }

  // Basic URL validation
  if (!url.match(/youtube\.com|youtu\.be/i)) {
    showError('দয়া করে সঠিক YouTube লিংক দিন');
    return;
  }

  currentVideoUrl = url;
  hideError();

  // Show loading
  document.getElementById('loadingSection').style.display = 'block';
  document.getElementById('videoSection').style.display = 'none';
  document.getElementById('fetchBtn').disabled = true;

  try {
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'ভিডিও তথ্য পেতে সমস্যা হয়েছে');
    }

    // Display video info
    displayVideoInfo(data);
  } catch (err) {
    showError(err.message || 'সার্ভারের সাথে সংযোগ করতে সমস্যা হয়েছে');
  } finally {
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('fetchBtn').disabled = false;
  }
}

// Display video information
function displayVideoInfo(data) {
  document.getElementById('thumbnail').src = data.thumbnail;
  document.getElementById('videoTitle').textContent = data.title;
  document.getElementById('duration').textContent = formatDuration(data.duration);
  
  // Update meta
  document.querySelector('#videoAuthor span').textContent = data.author;
  document.querySelector('#videoViews span').textContent = formatViews(data.views);

  // Build formats grid
  const grid = document.getElementById('formatsGrid');
  grid.innerHTML = '';

  data.formats.forEach(format => {
    const sizeText = format.filesize > 0 ? formatSize(format.filesize) : '';
    const audioInfo = format.has_audio ? '🔊 Audio' : '🔇 No Audio';
    const badge = format.height > 0 ? getQualityBadge(format.height) : '';

    const item = document.createElement('div');
    item.className = 'format-item';
    item.onclick = () => downloadVideo(format.format_id, format.quality);
    item.innerHTML = `
      <div class="format-info">
        <div class="format-quality">
          ${format.quality} ${badge}
        </div>
        <div class="format-size">${format.ext.toUpperCase()} ${sizeText ? '• ' + sizeText : ''} • ${audioInfo}</div>
      </div>
      <button class="format-download-btn" title="Download ${format.quality}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    `;
    grid.appendChild(item);
  });

  // Show video section
  document.getElementById('videoSection').style.display = 'block';
  document.getElementById('videoSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Download video
function downloadVideo(formatId, quality) {
  if (!currentVideoUrl) {
    showError('ভিডিও URL পাওয়া যায়নি');
    return;
  }

  // Show download progress
  const progress = document.getElementById('downloadProgress');
  progress.style.display = 'block';

  // Create download link - this triggers the server to stream the file
  const downloadUrl = `/api/download?url=${encodeURIComponent(currentVideoUrl)}&format_id=${encodeURIComponent(formatId)}`;
  
  // Use a hidden link to trigger download
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Hide progress after a delay
  setTimeout(() => {
    progress.style.display = 'none';
  }, 5000);
}
