<script lang="ts">
import { onMount } from "svelte";
import { removeBackground } from '@imgly/background-removal'
type ImageDataArray = Uint8ClampedArray;
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
let searchRangeStart = 0.5;
let searchRangeEnd = 1.0;
let playbackSpeed = 1.0; // 播放速度
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
function getImageHash(img: HTMLImageElement, size = 8) {
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
function hammingDistance(hash1: string, hash2: string) {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

function calculateSimilarity(data1: ImageDataArray, data2: ImageDataArray) {
  let diff = 0;
  const length = data1.length;
  
  for (let i = 0; i < length; i += 4) {
      // 比较RGB通道，忽略Alpha通道
    const rDiff = Math.abs(data1[i] - data2[i]);
    const gDiff = Math.abs(data1[i+1] - data2[i+1]);
    const bDiff = Math.abs(data1[i+2] - data2[i+2]);
    
    diff += (rDiff + gDiff + bDiff) / 3;
  }
  
  // 计算平均差异并转换为相似度
  const avgDiff = diff / (length / 4);
  const similarity = 1 - (avgDiff / 255);
  
  return Math.max(0, similarity);
}

function compare(img1: HTMLImageElement, img2: HTMLImageElement) {
  // 使用感知哈希算法计算相似度
  const hash1 = getImageHash(img1);
  const hash2 = getImageHash(img2);
  
  const distance = hammingDistance(hash1, hash2);
  const maxDistance = hash1.length;
  const similarity = 1 - (distance / maxDistance);
  
  return similarity;
}

function findLoop(start: number) {
  if (frames.length === 0) return;
  
  loopStart = start;
  const mark = frames[start].img;
  let bestSimilarity = 0;
  let bestMatchIndex = frames.length - 1;
  
  // 计算搜索范围
  const searchStart = Math.floor(frames.length * searchRangeStart);
  const searchEnd = Math.min(Math.floor(frames.length * searchRangeEnd), frames.length - 1);
  
  // 确保搜索范围大于起始帧
  const actualSearchStart = Math.max(searchStart, start + 30); // 至少间隔30帧避免相邻帧匹配
  
  // 重置所有帧的选中状态
  frames.forEach(frame => frame.select = false);
  frames[start].select = true;
  
  // 全局搜索最佳匹配帧
  for (let i = actualSearchStart; i <= searchEnd; i++) {
    const curSim = compare(frames[i].img, mark);

    console.log('curSim ==', curSim)
    
    // 更新最佳匹配
    if (curSim > bestSimilarity && curSim >= similarityThreshold) {
      bestSimilarity = curSim;
      bestMatchIndex = i;
    }
    
    // 标记正在搜索的帧
    frames[i].select = false;
  }
  
  // 设置循环结束帧
  if (bestSimilarity >= similarityThreshold) {
    loopEnd = bestMatchIndex - 1; // 匹配帧作为新的开始，所以结束帧是匹配帧的前一帧
    console.log(`找到最佳匹配帧，相似度: ${bestSimilarity.toFixed(4)}，循环范围: ${loopStart} 到 ${loopEnd}`);
    
    // 高亮显示循环范围内的帧
    for (let i = loopStart; i <= loopEnd; i++) {
      if (frames[i]) frames[i].select = true;
    }
  } else {
    loopEnd = frames.length - 1;
    alert(`未找到符合相似度阈值(${similarityThreshold})的匹配帧`);
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
  // 设置初始时间
  video.currentTime = 0;
  // 等待初始seek完成
  await waitForSeek(video);
  
  // 开始逐帧提取
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // 绘制当前帧到canvas
    ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    
    const nowFrameImg = frameCanvas.toDataURL('image/png')
    if (lastFrameImg !== nowFrameImg) {
      const src = frameCanvas.toDataURL('image/png')
      const img = new Image();
      img.src = src;
      frames = [...frames, { src, img }]
      lastFrameImg = nowFrameImg
      currentFrameIndex++;
    }
    
    // 如果还有下一帧，设置下一帧的时间
    if (frameIndex < totalFrames - 1) {
      video.currentTime = (frameIndex + 1) / frameRate;
      // 等待seek完成
      await waitForSeek(video);
    }
  }
  
  isProcessing = false;
  // 如果视频帧数较少，自动调整搜索范围
  if (frames.length < 60) {
    searchRangeStart = 0.3;
    searchRangeEnd = 1.0;
  }
  findLoop(0);
}

function begainLoop() {
  if (inRemoveBg || loopStart >= loopEnd) return;

  inLoop = true;
  loopFrame = loopStart;
  const frameInterval = 1000 / (frameRate * playbackSpeed);
  let lastFrameTime = Date.now();

  function run() {
    if (!inLoop) return;
    
    const now = Date.now();
    if (now - lastFrameTime >= frameInterval) {
      loopFrame++;
      if (loopFrame > loopEnd) {
        loopFrame = loopStart;
      }
      lastFrameTime = now;
    }
    
    requestAnimationFrame(run);
  }

  run();
}

function stopLoop() {
  inLoop = false;
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
    
    <div class="params-container">
      <div class="param-group">
        <label for="similarityThreshold">相似度阈值: {similarityThreshold.toFixed(2)}</label>
        <input type="range" bind:value={similarityThreshold} min="0.8" max="1.0" step="0.01" id="similarityThreshold" />
      </div>
      
      <div class="param-group">
        <label for="searchRangeStart">搜索范围起始: {searchRangeStart.toFixed(2)}</label>
        <input type="range" bind:value={searchRangeStart} min="0.0" max="0.9" step="0.05" id="searchRangeStart" />
      </div>
      
      <div class="param-group">
        <label for="searchRangeEnd">搜索范围结束: {searchRangeEnd.toFixed(2)}</label>
        <input type="range" bind:value={searchRangeEnd} min="0.1" max="1.0" step="0.05" id="searchRangeEnd" />
      </div>
      
      <button on:click={() => findLoop(loopStart)} class="primary">重新检测循环帧</button>
    </div>
    
    <div class="do-frame-container">
      {#if frames.length}
        {#each frames as frame, i }
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <img src={frame.src} alt={`${i}`} class={ frame.select ? 'selected' : '' } on:click={() => findLoop(i)}/>
        {/each}
      {/if}
    </div>
  </div>

  <div class="panel">
    <h2>循环播放</h2>
    
    <div class="loop-info">
      <p>循环范围: <span>{loopStart}</span> - <span>{loopEnd}</span></p>
      <p>总帧数: <span>{loopEnd > loopStart ? loopEnd - loopStart + 1 : 0}</span></p>
    </div>
    
    <div class="param-group">
      <label for="playbackSpeed">播放速度: {playbackSpeed.toFixed(1)}x</label>
      <input type="range" bind:value={playbackSpeed} min="0.25" max="4" step="0.25" id="playbackSpeed" />
    </div>
    
    <div class="frame-container">
      {#if inLoop && frames[loopFrame]}
        <img src={frames[loopFrame].src} alt={`${loopFrame}`}/>
      {:else if frames[loopStart]}
        <img src={frames[loopStart].src} alt="起始帧"/>
      {/if}
    </div>
    
    <div class="controls">
      {#if !inLoop}
        <button on:click={begainLoop} disabled={loopStart >= loopEnd} class="primary">开始播放</button>
      {:else}
        <button on:click={stopLoop} class="primary">停止播放</button>
      {/if}
      <button on:click={removeFrameBg} disabled={loopStart >= loopEnd}>清除背景</button>
    </div>
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
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-group label {
  font-weight: 600;
  font-size: 14px;
}

.loop-info {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  padding: 15px;
  margin-bottom: 20px;
  display: flex;
  gap: 20px;
  justify-content: center;
}

.loop-info p {
  margin: 0;
  font-size: 14px;
}

.loop-info span {
  font-weight: 600;
  color: #4a00e0;
}

.slider-container label {
  display: block;
  margin-bottom: 10px;
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
