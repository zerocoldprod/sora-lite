/**
 * public/js/app.js
 *
 * Handles:
 *  - Drag‑and‑drop / file picker
 *  - Preview thumbnails
 *  - Uploading to /upload (fetch)
 *  - Rendering progress & download links
 */

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const resultsSection = document.getElementById('results');
const fileList = document.getElementById('fileList');
const zipSection = document.getElementById('zipSection');
const zipLink = document.getElementById('zipLink');

let selectedFiles = [];

// ---------------------------------------------------------------------------
// Helper: format bytes → human readable
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = 2;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Drag & Drop UI
// ---------------------------------------------------------------------------
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900');
  });
});

dropZone.addEventListener('drop', e => {
  const dt = e.dataTransfer;
  const files = dt.files;
  handleFilesSelection(files);
});

// ---------------------------------------------------------------------------
// File input handling
// ---------------------------------------------------------------------------
fileInput.addEventListener('change', e => {
  handleFilesSelection(e.target.files);
});

function handleFilesSelection(fileListObj) {
  const filesArray = Array.from(fileListObj);
  // Filter allowed types
  const allowed = filesArray.filter(f => /\.(jpe?g|png)$/i.test(f.name));
  if (allowed.length !== filesArray.length) {
    alert('Only .jpg, .jpeg and .png files are allowed.');
  }

  // Enforce max 20 files
  if (allowed.length + selectedFiles.length > 20) {
    alert('You can upload a maximum of 20 files at a time.');
    return;
  }

  selectedFiles = selectedFiles.concat(allowed);
  renderPreviews();
}

// ---------------------------------------------------------------------------
// Render thumbnails & file cards (before upload)
// ---------------------------------------------------------------------------
function renderPreviews() {
  resultsSection.classList.remove('hidden');
  fileList.innerHTML = '';

  selectedFiles.forEach((file, idx) => {
    const li = document.createElement('li');
    li.className = 'border rounded-lg p-4 bg-neutral-50 dark:bg-neutral-800 fade-in';
    li.id = `file-${idx}`;

    const img = document.createElement('img');
    img.className = 'h-24 w-24 object-cover rounded mr-4';
    img.src = URL.createObjectURL(file);

    const name = document.createElement('p');
    name.textContent = file.name;
    name.className = 'font-medium';

    const size = document.createElement('p');
    size.textContent = formatBytes(file.size);
    size.className = 'text-sm text-gray-600 dark:text-gray-400';

    const progressBar = document.createElement('div');
    progressBar.className = 'w-full bg-neutral-200 rounded-full h-2.5 mt-2';
    const progress = document.createElement('div');
    progress.className = 'bg-blue-600 h-2.5 rounded-full';
    progress.style.width = '0%';
    progressBar.appendChild(progress);

    const status = document.createElement('p');
    status.className = 'mt-2 text-sm text-gray-600 dark:text-gray-400';
    status.textContent = 'Waiting…';

    const container = document.createElement('div');
    container.className = 'flex items-center';
    container.appendChild(img);

    const txt = document.createElement('div');
    txt.className = 'inner-file';
    txt.appendChild(name);
    txt.appendChild(size);
    const btnsContainer = document.createElement('div');
    btnsContainer.className = 'btns-container';
    txt.appendChild(btnsContainer);
    // txt.appendChild(status);
    // txt.appendChild(progressBar);

    container.appendChild(txt);
    li.appendChild(container);
    fileList.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Upload all selected files
// ---------------------------------------------------------------------------
async function uploadAll() {
  if (selectedFiles.length === 0) return;

  const formData = new FormData();
  selectedFiles.forEach(f => formData.append('images', f));

  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      alert(err.error || 'Upload failed');
      return;
    }

    const result = await response.json();
    // Update UI with after‑size and download links
    result.files.forEach((fileInfo, idx) => {
      const li = document.getElementById(`file-${idx}`);
      // child div.inner-file of li
      const containerBtn = li.querySelector('.inner-file .btns-container');
      const status = li.querySelector('p.text-sm');
      const progress = li.querySelector('div > div');
      status.textContent = `Compressed – ${formatBytes(fileInfo.sizeAfter)} (saved ${(
        100 *
        (1 - fileInfo.sizeAfter / fileInfo.sizeBefore)
      ).toFixed(1)}%)`;
      progress.style.width = '100%';
      // Add download button
      const dlBtn = document.createElement('a');
      dlBtn.href = fileInfo.downloadUrl;
      dlBtn.textContent = 'Download';
      dlBtn.className = 'inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-1 px-2 rounded mt-2';
      dlBtn.setAttribute('download', fileInfo.optimizedName);
      containerBtn.appendChild(dlBtn);

      
      // Add download button
      const CompareBtn = document.createElement('a');
      CompareBtn.href = "#";
      CompareBtn.textContent = 'Compare';
      CompareBtn.className = 'inline-block bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-1 px-2 rounded mt-2';
      CompareBtn.id = `openModalBtn-${idx}`;
      CompareBtn.setAttribute('compare', fileInfo.optimizedName);
      containerBtn.appendChild(CompareBtn);

      // Exemple d’utilisation :
      document.getElementById(`openModalBtn-${idx}`).addEventListener('click', () => {
            openDynamicModal({
              title: fileInfo.originalName,
              imgBefore: fileInfo.uploadUrl,
              imgAfter: fileInfo.downloadUrl,
              details : fileInfo
          });
      });
    });

    if (result.zip) {
      zipLink.href = result.zip.url;
      zipSection.classList.remove('hidden');
    }
  } catch (e) {
    console.error(e);
    alert('Something went wrong while uploading.');
  }
}

// ---------------------------------------------------------------------------
// Trigger upload when files are selected (auto‑start)
// ---------------------------------------------------------------------------

fileInput.addEventListener('change', () => {
  // Small timeout to allow UI to render previews before uploading
  setTimeout(uploadAll, 300);
});

// Also start upload after a drag‑and‑drop selection
dropZone.addEventListener('drop', () => {
  setTimeout(uploadAll, 300);
});


// ---------------------------------------------------------------------------
// Modal Comparaison Slider
// ---------------------------------------------------------------------------

function openDynamicModal({ title, imgBefore, imgAfter, details, onConfirm }) {
  // Créer le conteneur global de la modal
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';

  // Contenu interne (le panneau)
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-4xl mx-4 transform transition-all duration-200 ease-out scale-95 opacity-0">
      <header class="flex justify-between items-center">
        <h2 class="text-lg font-semibold text-gray-900">${title}</h2>
        <button id="closeModalBtn" class="text-gray-500 hover:text-gray-800 text-xl leading-none">&times;</button>
      </header>
      <main class="main-modal mt-4 text-gray-700">
        
        <div id="image-compare">
          <img src="${imgBefore}" alt="" />
          <img src="${imgAfter}" alt="" />
        </div>

        <div class="details-infos">
        
          <p>${formatBytes(details.sizeBefore)} <small>(Original)</small></p>



          <p>${formatBytes(details.sizeAfter)} <small>(saved ${(
        100 *
        (1 - details.sizeAfter / details.sizeBefore)
      ).toFixed(1)}%)</small></p>
          
        </div>
      </main>
    </div>
  `;

  document.body.appendChild(modal);

  const panel = modal.querySelector('div');
  const closeBtn = modal.querySelector('#closeModalBtn');
  const cancelBtn = modal.querySelector('#cancelBtn');
  const confirmBtn = modal.querySelector('#confirmBtn');

  // petite animation d’apparition
  requestAnimationFrame(() => {
    panel.classList.remove('scale-95', 'opacity-0');
    panel.classList.add('scale-100', 'opacity-100');
  });

  // Fonction pour fermer et supprimer la modal
  function closeModal() {
    panel.classList.remove('scale-100', 'opacity-100');
    panel.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.remove(), 200);
  }

  // Gestion des événements
  closeBtn.addEventListener('click', closeModal);
  // cancelBtn.addEventListener('click', closeModal);
  // confirmBtn.addEventListener('click', () => {
  //   if (typeof onConfirm === 'function') onConfirm();
  //   closeModal();
  // });

  // Clic sur l’arrière-plan
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const element = document.getElementById("image-compare");
  const viewer = new ImageCompare(element).mount();

  // Fermeture via la touche Échap
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  });
}