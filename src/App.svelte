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

function calculateSimilarity(data1: ImageDataArray, data2: ImageDataArray) {
  let diff = 0;
  const length = data1.length;
  const sampleRate = 8; // 采样率，减少计算量
  const samples = length / 4 / sampleRate;
  
  for (let i = 0; i < length; i += 4 * sampleRate) {
      // 比较RGB通道，忽略Alpha通道
    const rDiff = Math.abs(data1[i] - data2[i]);
    const gDiff = Math.abs(data1[i+1] - data2[i+1]);
    const bDiff = Math.abs(data1[i+2] - data2[i+2]);
    
    diff += (rDiff + gDiff + bDiff) / 3;
  }
  
  // 计算平均差异并转换为相似度
  const avgDiff = diff / samples;
  const similarity = 1 - (avgDiff / 255);
  
  return Math.max(0, similarity);
}

function compare(img1: HTMLImageElement, img2: HTMLImageElement) {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d') as CanvasRenderingContext2D;
  const size = 64; // 缩小尺寸，减少计算量
  tempCanvas.width = size;
  tempCanvas.height = size;
  
  // 绘制并缩小第一张图
  tempCtx.drawImage(img1, 0, 0, size, size);
  const imageData1 = tempCtx.getImageData(0, 0, size, size);
  
  // 绘制并缩小第二张图
  tempCtx.clearRect(0, 0, size, size);
  tempCtx.drawImage(img2, 0, 0, size, size);
  const imageData2 = tempCtx.getImageData(0, 0, size, size);
  
  // 计算相似度
  return calculateSimilarity(imageData1.data, imageData2.data)
}

function findLoop(start: number) {
  // 重置所有选择状态
  frames.forEach(frame => frame.select = false);
  
  loopStart = start;
  frames[start].select = true;
  const mark = frames[start].img;
  const minLoopLength = 10; // 最小循环长度
  const maxLoopLength = Math.min(300, Math.floor(frames.length / 2)); // 最大循环长度
  const similarityThreshold = 0.95; // 相似度阈值
  
  let bestMatchIndex = -1;
  let highestSimilarity = 0;
  
  // 在合理范围内寻找最相似的帧
  for (let i = start + minLoopLength; i < start + maxLoopLength && i < frames.length; i++) {
    const curSim = compare(frames[i].img, mark);
    
    if (curSim > similarityThreshold && curSim > highestSimilarity) {
      highestSimilarity = curSim;
      bestMatchIndex = i;
      
      // 如果相似度非常高，提前结束搜索
      if (curSim > 0.98) {
        break;
      }
    }
  }
  
  if (bestMatchIndex !== -1) {
    loopEnd = bestMatchIndex - 1;
    // 标记循环范围内的帧
    for (let i = start; i <= loopEnd; i++) {
      frames[i].select = true;
    }
  } else {
    // 如果没找到，默认使用从start到末尾的范围
    loopEnd = frames.length - 1;
    // 标记循环范围内的帧
    for (let i = start; i <= loopEnd; i++) {
      frames[i].select = true;
    }
    console.warn('未找到明显的循环帧，使用默认范围');
  }
  
  console.log(`找到循环范围: ${loopStart} - ${loopEnd}`);
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
  
  // 开始逐帧提取
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // 绘制当前帧到canvas
    ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    
    const nowFrameImg = frameCanvas.toDataURL('image/png')
    if (lastFrameImg !== nowFrameImg) {
      const src = frameCanvas.toDataURL('image/png')
      const img = new Image();
      img.src = src;
      frames.push({ src, img });
      lastFrameImg = nowFrameImg;
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
  console.log(`提取了 ${frames.length} 帧`);
  if (frames.length > 0) {
    findLoop(0);
  }
}

function begainLoop() {
  if (inRemoveBg || loopStart >= loopEnd) return

  inLoop = true
  loopFrame = loopStart
  const startTime = performance.now();
  const frameDuration = 1000 / frameRate; // 每帧持续时间(ms)

  function run(currentTime: number) {
    if (!inLoop) return;
    
    const elapsed = currentTime - startTime;
    const expectedFrame = Math.floor(elapsed / frameDuration);
    const actualFrame = loopStart + (expectedFrame % (loopEnd - loopStart + 1));
    
    if (actualFrame !== loopFrame) {
      loopFrame = actualFrame;
    }
    
    requestAnimationFrame(run);
  }

  requestAnimationFrame(run);
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
