import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { GlobalWorkerOptions } from 'pdfjs-dist';
// 设置 Worker 脚本的路径
GlobalWorkerOptions.workerSrc = '/vender/pdf.worker.mjs';

createRoot(document.getElementById("root")!).render(<App />);
