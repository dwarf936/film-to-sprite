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
  // 检查frameCanvas是否已初始化
  if (!frameCanvas) {
    console.error('frameCanvas尚未初始化');
    return 0;
  }
  
  // 检查图像是否已加载完成
  if (!img1.complete || !img2.complete) {
    console.error('图像尚未加载完成');
    return 0;
  }
  
  const tempCanvas1 = document.createElement('canvas');
  const tempCtx1 = tempCanvas1.getContext('2d') as CanvasRenderingContext2D;
  tempCanvas1.width = frameCanvas.width;
  tempCanvas1.height = frameCanvas.height;
  tempCtx1.drawImage(img1, 0, 0);
  
  const tempCanvas2 = document.createElement('canvas');
  const tempCtx2 = tempCanvas2.getContext('2d') as CanvasRenderingContext2D;
  tempCanvas2.width = frameCanvas.width;
  tempCanvas2.height = frameCanvas.height;
  tempCtx2.drawImage(img2, 0, 0);
  
  // 获取图像数据
  const imageData1 = tempCtx1.getImageData(0, 0, tempCanvas1.width, tempCanvas1.height);
  const imageData2 = tempCtx2.getImageData(0, 0, tempCanvas2.width, tempCanvas2.height);
  
  // 计算相似度
  return calculateSimilarity(imageData1.data, imageData2.data)
}

// 添加参数配置
let loopSensitivity = 0.95; // 循环检测灵敏度，值越高要求越严格
let processingPrecision = 'medium'; // 处理精度: low, medium, high
let batchSize = 30; // 帧提取批量大小
let parallelLimit = 4; // 背景去除并行数
let canvasQuality = 1.0; // 画布质量，0.1-1.0

// 根据处理精度调整参数
function updatePrecisionSettings() {
  switch(processingPrecision) {
    case 'low':
      batchSize = 60; // 更大的批量
      parallelLimit = 8; // 更多的并行
      canvasQuality = 0.5; // 降低画布质量
      break;
    case 'medium':
      batchSize = 30; // 中等批量
      parallelLimit = 4; // 中等并行
      canvasQuality = 1.0; // 高质量
      break;
    case 'high':
      batchSize = 15; // 更小的批量
      parallelLimit = 2; // 更少的并行
      canvasQuality = 1.0; // 高质量
      break;
  }
}

function findLoop(start: number) {
  let lastSim = 1
  loopStart = start
  frames[start].select = true
  const mark = frames[start].img
  let selectFlag = true
  let maxSimilarity = 0;
  let bestLoopEnd = start;
  
  if (start > 0) {
    for (let i = 0; i < start; i++) {
      frames[i].select = false
    }
  }
  
  // 使用更精确的循环检测算法
  for (let i = start + 1, l = frames.length; i < l; i++) {
    if (selectFlag) {
      const curSim = compare(frames[i].img, mark)
      
      // 记录最高相似度
      if (curSim > maxSimilarity) {
        maxSimilarity = curSim;
        bestLoopEnd = i - 1;
      }
      
      // 当相似度超过阈值且开始下降时，认为找到循环
      if (curSim > loopSensitivity && curSim < lastSim) {
        selectFlag = false
        loopEnd = i - 1
      }
      lastSim = curSim
    }
    frames[i].select = selectFlag
    
  }
  
  // 如果没有找到明确的循环结束点，使用相似度最高的点
  if (selectFlag === true && frames.length - 1 > start) {
    loopEnd = bestLoopEnd > start ? bestLoopEnd : frames.length - 2
    
    // 如果相似度仍然很低，提示用户
    if (maxSimilarity < 0.8) {
      alert('未找到明显的循环模式，已自动选择最佳匹配点')
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
  
  // 更新处理精度参数
  updatePrecisionSettings();
  
  isProcessing = true;
  frames = [];
  currentFrameIndex = 0;
  
  // 设置视频播放速率为最大，以快速播放
  video.playbackRate = 16; // 最大速率
  video.currentTime = 0;
  
  // 开始批量提取
  let remainingFrames = totalFrames;
  
  while (remainingFrames > 0) {
    const currentBatchSize = Math.min(batchSize, remainingFrames);
    
    // 使用Promise.all并行处理一批帧
    await Promise.all(Array.from({ length: currentBatchSize }, async (_, i) => {
      const frameIndex = totalFrames - remainingFrames + i;
      
      // 设置当前帧时间
      video.currentTime = frameIndex / frameRate;
      
      // 短暂等待帧渲染（比waitForSeek快）
      await new Promise(resolve => setTimeout(resolve, 16));
      
      // 绘制当前帧到canvas
      ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
      
      // 根据画布质量调整toDataURL的质量参数
      const src = frameCanvas.toDataURL('image/png', canvasQuality)
      const img = new Image();
      img.src = src;
      // 等待图像加载完成
      await new Promise(resolve => img.onload = resolve);
      frames.push({ src, img });
      currentFrameIndex++;
    }));
    
    remainingFrames -= currentBatchSize;
  }
  
  // 恢复正常播放速率
  video.playbackRate = 1;
  
  isProcessing = false;
  findLoop(0);
}

// 添加播放速度控制参数
let playSpeed = 0.5; // 播放速度，值越小越慢，0.1-1.0

function beginLoop() {
  if (inRemoveBg) return

  inLoop = true
  loopFrame = loopStart

  function run() {
    setTimeout(() => {
      loopFrame++
      console.log(loopFrame, loopEnd)
      if (loopFrame > loopEnd) loopFrame = loopStart
      if (inLoop) run()
    }, 1000 / (60 * playSpeed)); // 控制播放速度
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
  
  // 更新处理精度参数
  updatePrecisionSettings();
  
  // 并行处理，每次最多同时处理parallelLimit个帧
  const framesToProcess = frames.slice(loopStart, loopEnd + 1);
  const totalFramesToProcess = framesToProcess.length;
  
  // 分块处理
  for (let i = 0; i < totalFramesToProcess; i += parallelLimit) {
    const batch = framesToProcess.slice(i, i + parallelLimit);
    await Promise.all(batch.map(frame => removeBg(frame)));
    console.log(`完成 ${Math.min(i + parallelLimit, totalFramesToProcess)}/${totalFramesToProcess} 帧`);
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
      <input type="range" bind:this={frameSlider} id="frameSlider" bind:value={currentFrameIndex} min="0" max={frames.length}>
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
          <button class={ frame.select ? 'selected' : '' } on:click={() => findLoop(i)} aria-label={`选择帧 ${i}`} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') findLoop(i); }} tabindex="0">
            <img src={frame.src} alt={`${i}`} />
          </button>
        {/each}
      {/if}
    </div>
  </div>

  <div class="panel">
    <h2>参数设置</h2>
    <div class="settings-group">
      <label for="loopSensitivity">循环检测灵敏度</label>
      <input 
        type="range" 
        id="loopSensitivity" 
        bind:value={loopSensitivity} 
        min="0.8" 
        max="1.0" 
        step="0.01" 
      />
      <span>{loopSensitivity.toFixed(2)}</span>
    </div>
    
    <div class="settings-group">
      <label for="processingPrecision">处理精度</label>
      <select 
        id="processingPrecision" 
        bind:value={processingPrecision}
      >
        <option value="low">低（快速）</option>
        <option value="medium">中（平衡）</option>
        <option value="high">高（精确）</option>
      </select>
    </div>
    
    <div class="settings-group">
      <label for="playSpeed">播放速度</label>
      <input 
        type="range" 
        id="playSpeed" 
        bind:value={playSpeed} 
        min="0.1" 
        max="1.0" 
        step="0.1" 
      />
      <span>{playSpeed.toFixed(2)}x</span>
    </div>
    
    <div class="settings-group">
      <label for="parameterExplanation">参数说明：</label>
      <div id="parameterExplanation">
        <p><strong>循环检测灵敏度</strong>：值越高，循环检测越严格，适合动作幅度小的视频。</p>
        <p><strong>处理精度</strong>：低精度处理速度快但质量稍差；高精度质量好但处理速度慢。</p>
        <p><strong>播放速度</strong>：值越小，动画播放速度越慢；值越大，动画播放速度越快。</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>循环播放</h2>
    <div class="frame-container">
      {#if inLoop }
        <img src={frames[loopFrame].src} alt={`${loopFrame}`}/>
      {/if}
    </div>
    <button on:click={beginLoop}>开始播放</button>
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

.do-frame-container button {
  max-height: 100px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.do-frame-container button.selected {
  border: 2px solid #4a00e0;
  border-radius: 5px;
}

.do-frame-container button img {
  max-width: 100%;
  max-height: 100px;
  display: block;
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

.settings-group {
  margin-bottom: 25px;
}

.settings-group label {
  display: block;
  margin-bottom: 10px;
  font-weight: 600;
}

.settings-group select {
  width: 100%;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #000;
  font-size: 16px;
}

.settings-group input[type="range"] + span {
  display: inline-block;
  margin-left: 10px;
  min-width: 50px;
  text-align: center;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.settings-group p {
  margin: 5px 0;
  color: #666;
  font-size: 14px;
}
</style>
