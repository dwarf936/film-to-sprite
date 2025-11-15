const ffmpeg = require('fluent-ffmpeg');

const inputVideo = '1.mp4'; // 你的视频文件路径
const outputFolder = 'output_frames'; // 图片输出文件夹

ffmpeg(inputVideo)
  .outputOptions('-vf', 'fps=30') // 每秒输出一帧
  .output(outputFolder + '/frame_%d.png') // 命名规则，例如 frame_1.png, frame_2.png
  .on('end', () => {
    console.log('帧提取完成！');
  })
  .on('error', (err) => {
    console.error('发生错误：', err.message);
  })
  .run();