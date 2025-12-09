<script lang="ts">
import { onMount } from "svelte";
import { removeBackground } from '@imgly/background-removal'
interface Frame{ src: string, select?: boolean, img: HTMLImageElement }

const frameRate = 30
let fileInput: HTMLInputElement
let videoURL: string
let video: HTMLVideoElement
let frameSlider: HTMLInputElement
let width: number
let height: number
let frameCanvas: HTMLCanvasElement
let duration: number
let totalFrames: number
let currentFrameIndex: number = 0
let lastFrameImg = ''
let loopStart = 0;
let loopEnd = 0;
let inLoop = false;
let inRemoveBg = false;
let loopFrame = 0
let frames: Frame[] = []
// 循环检测参数
let similarityThreshold = 0.95;
let searchRange = 0.5; // 搜索后50%的帧
let isProcessing = false
let ctx: CanvasRenderingContext2D

function formatTime(seconds: number) {
  if (!seconds) return '00:00'
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

onMount(() => {
  ctx = frameCanvas.getContext('2d') as CanvasRenderingContext2D
})

function onupload() {
  fileInput.click()
}

function onloadedmetadata() {
  duration = video.duration
  width = video.videoWidth
  height = video.videoHeight
}

function oncanplay() {
  totalFrames = Math.floor(frameRate * duration)
}

function handleVideoFile(file: File) {
  if (!file.type.includes('video/mp4')) {
    alert('请上传MP4格式的视频文件');
    return;
  }
  videoURL = URL.createObjectURL(file);
}

function onchange(e: Event & { currentTarget: HTMLInputElement }) {
  if (e.currentTarget?.files?.length) {
    handleVideoFile(e.currentTarget?.files[0]);
  }
}

// 感知哈希算法计算图片指纹
function getImageHash(img: HTMLImageElement, size = 8): string {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d') as CanvasRenderingContext2D;
  tempCanvas.width = size;
  tempCanvas.height = size;
  
  // 缩小图片并转为灰度
  tempCtx.drawImage(img, 0, 0, size, size);
  const imageData = tempCtx.getImageData(0, 0, size, size);
  const data = imageData.data;
  
  // 计算灰度平均值
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    total += gray;
  }
  const avg = total / (size * size);
  
  // 计算哈希值
  let hash = '';
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    hash += gray >= avg ? '1' : '0';
  }
  
  return hash;
}

// 计算两个哈希值的汉明距离
function hammingDistance(hash1: string, hash2: string): number {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}



// 使用感知哈希计算相似度
function calculateSimilarityByHash(img1: HTMLImageElement, img2: HTMLImageElement): number {
  const hash1 = getImageHash(img1);
  const hash2 = getImageHash(img2);
  
  const distance = hammingDistance(hash1, hash2);
  const maxDistance = hash1.length;
  // 转换为相似度分数(0-1)
  const similarity = 1 - (distance / maxDistance);
  
  return similarity;
}

async function compare(img1: HTMLImageElement, img2: HTMLImageElement) {
  // 直接使用感知哈希计算相似度
  return calculateSimilarityByHash(img1, img2);
}

// 兼容旧的函数调用签名
function calculateSimilarity(data1: ImageDataArray, data2: ImageDataArray) {
  return new Promise<number>((resolve) => {
    // 创建临时图片元素用于哈希计算
    const tempCanvas1 = document.createElement('canvas');
    const tempCtx1 = tempCanvas1.getContext('2d') as CanvasRenderingContext2D;
    tempCanvas1.width = Math.sqrt(data1.length / 4);
    tempCanvas1.height = Math.sqrt(data1.length / 4);
    tempCtx1.putImageData(new ImageData(data1, tempCanvas1.width, tempCanvas1.height), 0, 0);
    
    const tempCanvas2 = document.createElement('canvas');
    const tempCtx2 = tempCanvas2.getContext('2d') as CanvasRenderingContext2D;
    tempCanvas2.width = Math.sqrt(data2.length / 4);
    tempCanvas2.height = Math.sqrt(data2.length / 4);
    tempCtx2.putImageData(new ImageData(data2, tempCanvas2.width, tempCanvas2.height), 0, 0);
    
    const img1 = new Image();
    const img2 = new Image();
    
    let loadedCount = 0;
    
    function onLoad() {
      loadedCount++;
      if (loadedCount === 2) {
        resolve(calculateSimilarityByHash(img1, img2));
      }
    }
    
    img1.onload = onLoad;
    img2.onload = onLoad;
    
    img1.src = tempCanvas1.toDataURL();
    img2.src = tempCanvas2.toDataURL();
    
    // 如果图片缓存中已有，直接触发onLoad
    if (img1.complete) onLoad();
    if (img2.complete) onLoad();
  });
}

async function findLoop(start: number) {
  // 重置所有帧选中状态
  frames.forEach(frame => frame.select = false);
  
  loopStart = start;
  frames[start].select = true;
  const mark = frames[start].img;
  
  // 计算搜索范围起始位置
  const searchStartIndex = Math.floor(frames.length * (1 - searchRange));
  const searchEndIndex = frames.length - 1;
  
  console.log(`从第 ${searchStartIndex} 帧到第 ${searchEndIndex} 帧搜索匹配`);
  
  let bestMatchIndex = -1;
  let highestSimilarity = 0;
  
  // 遍历搜索范围内的所有帧寻找最佳匹配
  for (let i = Math.max(searchStartIndex, start + 10); i <= searchEndIndex; i++) {
    // 跳过太近的帧，避免匹配到相邻帧
    if (Math.abs(i - start) < 10) continue;
    
    const curSim = await compare(frames[i].img, mark);
    
    if (curSim > highestSimilarity && curSim >= similarityThreshold) {
      highestSimilarity = curSim;
      bestMatchIndex = i;
    }
  }
  
  // 找到最佳匹配
  if (bestMatchIndex !== -1) {
    loopEnd = bestMatchIndex - 1;
    console.log(`找到最佳匹配: 帧 ${start} 和帧 ${bestMatchIndex}，相似度: ${highestSimilarity.toFixed(4)}`);
    
    // 标记选中的循环范围
    for (let i = start; i <= loopEnd; i++) {
      frames[i].select = true;
    }
  } else {
    // 没有找到匹配，使用原逻辑
    loopEnd = frames.length - 2;
    alert(`未找到符合相似度阈值(${similarityThreshold})的匹配帧，请降低阈值重试`);
    
    // 标记从start到结束的所有帧
    for (let i = start; i <= loopEnd; i++) {
      frames[i].select = true;
    }
  }
}

function waitForSeek(video: HTMLVideoElement) {
  return new Promise(resolve => {
    video.addEventListener('seeked', function onSeeked() {
      video.removeEventListener('seeked', onSeeked);
      resolve(true);
    });
  });
}

async function extractAllFrames() {
  if (!video || isProcessing) return;
  
  isProcessing = true;
  frames = [];
  currentFrameIndex = 0;
  lastFrameImg = '';
  // 设置初始时间
  video.currentTime = 0;
  // 等待初始seek完成
  await waitForSeek(video);
  
  // 开始逐帧提取，移除去重逻辑确保提取所有帧
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // 绘制当前帧到canvas
    ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    
    const src = frameCanvas.toDataURL('image/png')
    const img = new Image();
    img.src = src;
    frames = [...frames, { src, img }]
    currentFrameIndex++;
    
    // 如果还有下一帧，设置下一帧的时间
    if (frameIndex < totalFrames - 1) {
      video.currentTime = (frameIndex + 1) / frameRate;
      // 等待seek完成
      await waitForSeek(video);
    }
  }
  
  isProcessing = false;
  await findLoop(0);
}

function begainLoop() {
  if (inRemoveBg) return

  inLoop = true
  loopFrame = loopStart

  function run() {
    requestAnimationFrame(() => {
      loopFrame++
      console.log(loopFrame, loopEnd)
      if (loopFrame > loopEnd) loopFrame = loopStart
      if (inLoop) run()
    })
  }

  run()
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); // 结果形如 "data:image/png;base64,iVBOR..."
    reader.onerror = () => reject(new Error('转换失败'));
    reader.readAsDataURL(blob);
  });
}

async function removeBg(frame: Frame) {
  const blob = await removeBackground(frame.src, {
    proxyToWorker: true,
    device: 'gpu'
  })
  frame.src = await blobToBase64(blob)
}

async function removeFrameBg() {
  inLoop = false
  inRemoveBg = true
  for (let i = loopStart, l = loopEnd; i <= l; i++) {
    await removeBg(frames[i])
    console.log('完成✅', i)
  }
  inRemoveBg = false
}
</script>

<main class="main-content">
  <div class="panel">
    <h2>视频上传</h2>
    <div role="button" on:keydown={onupload} tabindex="0" class="upload-area" on:click={onupload}>
      <i>📁</i>
      <p>点击或拖拽MP4文件到此区域</p>
      <p class="subtitle">支持MP4格式视频文件</p>
    </div>
    <input type="file" bind:this={fileInput} on:change={onchange} accept="video/mp4" class="hidden">

    <div class="video-preview-container">
      <!-- svelte-ignore a11y-media-has-caption -->
      <video bind:this={video} src={videoURL} on:loadedmetadata={onloadedmetadata} on:canplay={oncanplay} class="video-preview" controls></video>
    </div>

    <div class="controls">
      <button id="extractFrames" on:click={extractAllFrames} class="primary" disabled={isProcessing}>
        <span>提取所有帧</span>
      </button>
    </div>
  </div>

  <div class="panel">
    <h2>帧查看器</h2>
    <div class="frame-container">
      {#if frames[currentFrameIndex]}
        <img src={frames[currentFrameIndex].src} alt={`${currentFrameIndex}`} height={height} />
      {:else}
        <canvas bind:this={frameCanvas} class="frame-canvas" width={width} height={height}></canvas>
      {/if}
    </div>
    
    <div class="frame-info">
      <p>当前帧: <span id="currentFrame">{currentFrameIndex}</span> / <span id="totalFrames">{frames.length}</span></p>
    </div>
    
    <div class="slider-container">
      <label for="frameSlider">帧导航:</label>
      <input type="range" bind:this={frameSlider} bind:value={currentFrameIndex} min="0" max={frames.length}>
    </div>
    
    <!-- <div class="controls">
      <button id="prevFrame">
        <span>◀</span> 上一帧
      </button>
      <button id="nextFrame">
        下一帧 <span>▶</span>
      </button>
      <button id="exportFrame">
        <span>💾</span> 导出当前帧
      </button>
    </div> -->
  </div>

  <div class="panel">
    <h2>帧处理</h2>
    
    <div class="help-text">
      <h4>使用说明</h4>
      <p>1. 点击任意帧作为循环起始点</p>
      <p>2. 调整参数自动搜索最佳匹配的循环结束点</p>
      <p>3. 选中的帧会高亮显示，表示循环播放范围</p>
    </div>
    
    <div class="params-container">
      <div class="param-item">
        <label for="similarityThreshold">相似度阈值: {similarityThreshold.toFixed(2)}</label>
        <input type="range" id="similarityThreshold" bind:value={similarityThreshold} min="0.8" max="1.0" step="0.01" on:input={async () => { if (frames.length > 0 && loopStart >= 0) await findLoop(loopStart); }} />
        <small>值越高匹配越严格，默认: 0.95。如果未找到匹配请适当降低此值。</small>
      </div>
      
      <div class="param-item">
        <label for="searchRange">搜索范围比例: {searchRange.toFixed(2)}</label>
        <input type="range" id="searchRange" bind:value={searchRange} min="0.1" max="0.9" step="0.1" on:input={async () => { if (frames.length > 0 && loopStart >= 0) await findLoop(loopStart); }} />
        <small>设置从视频后N%的帧中搜索匹配帧，默认: 0.5。值越小搜索范围越靠后。</small>
      </div>
    </div>

    <div class="do-frame-container">
      {#if frames.length}
        {#each frames as frame, i }
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <img src={frame.src} alt={`${i}`} class={ frame.select ? 'selected' : '' } on:click={async () => await findLoop(i)}/>
        {/each}
      {/if}
    </div>
  </div>

  <div class="panel">
    <h2>循环播放</h2>
    <div class="frame-container">
      {#if inLoop }
        <img src={frames[loopFrame].src} alt={`${loopFrame}`}/>
      {/if}
    </div>
    <button on:click={begainLoop}>开始播放</button>
    <button on:click={removeFrameBg}>清除背景</button>
  </div>
</main>

<style>
.hidden {
  display: none;
}
.main-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}
.panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 15px;
  padding: 25px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.panel h2 {
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.upload-area {
  border: 2px dashed rgba(55, 178, 255, 0.3);
  border-radius: 10px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 20px;
}

.upload-area:hover {
  border-color: rgba(5, 101, 246, 0.5);
  background: rgba(255, 255, 255, 0.05);
}

.upload-area i {
  font-size: 48px;
  margin-bottom: 15px;
  opacity: 0.7;
}

.video-preview {
  width: 100%;
  max-height: 300px;
  border-radius: 10px;
  background: #000;
  margin-bottom: 20px;
}

.frame-container {
  width: 100%;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 20px;
}

.frame-container img {
  max-width: 100%;
  max-height: 100%;
}

.do-frame-container {
  width: 100%;
  display: block;
  background: #000;
  border-radius: 10px;
  margin-bottom: 20px;
}

.do-frame-container img {
  max-height: 100px;
}
.do-frame-container img.selected {
  opacity: 0.8;
}

.frame-canvas {
  max-width: 100%;
  max-height: 100%;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

button {
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid #999;
  border-radius: 8px;
  color: #000;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  flex: 1;
  min-width: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

button:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
}

button:active {
  transform: translateY(1px);
}

button.primary {
  background: #4a00e0;
}

button.primary:hover {
  background: #5a10f0;
}

.frame-info {
  text-align: center;
  padding: 15px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  margin-bottom: 20px;
}

.slider-container {
  margin: 20px 0;
}

.params-container {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.param-item {
  padding: 15px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

.param-item label {
  display: block;
  margin-bottom: 10px;
  font-weight: 600;
}

.help-text {
  margin-bottom: 20px;
  padding: 15px;
  background: rgba(74, 0, 224, 0.1);
  border-radius: 8px;
  border-left: 4px solid #4a00e0;
}

.help-text h4 {
  margin: 0 0 10px 0;
  color: #4a00e0;
}

.help-text p {
  margin: 5px 0;
  font-size: 0.95em;
  opacity: 0.9;
}

.param-item small {
  display: block;
  margin-top: 8px;
  opacity: 0.7;
  font-size: 0.9em;
}

input[type="range"] {
  width: 100%;
  height: 8px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.1);
  outline: none;
  -webkit-appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #4a00e0;
  cursor: pointer;
}
</style>
