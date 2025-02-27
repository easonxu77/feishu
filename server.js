import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const port = 3000;

// 配置CORS
app.use(cors());
app.use(express.json());

// 配置静态文件服务
app.use(express.static('public'));

// 配置安全头
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; font-src 'self' data: *; img-src 'self' data: *");
    next();
});

// 火山方舟API配置
const API_KEY = '7f60cb6b-6b82-41c6-9718-055a381c6d14';
const API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 验证请求数据
function validateRequest(req) {
    if (!req.body || !req.body.message || typeof req.body.message !== 'string') {
        throw new Error('无效的请求数据');
    }
    if (req.body.message.length > 2000) { // 设置合理的消息长度限制
        throw new Error('消息长度超出限制');
    }
}

// 处理聊天请求
app.post('/chat', async (req, res) => {
    try {
        // 验证请求数据
        validateRequest(req);

        // 设置响应头，启用流式传输
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 准备请求数据
        const requestData = {
            model: 'deepseek-r1-250120',
            messages: [
                {
                    role: 'system',
                    content: '你是一位专业的生活教练，擅长倾听、共情和提供建设性的建议。你的目标是通过对话帮助用户实现个人成长，提供具体且可行的建议。请用友善、专业的语气与用户交流。'
                },
                {
                    role: 'user',
                    content: req.body.message
                }
            ],
            stream: true,
            temperature: 0.6
        };

        // 设置API请求超时
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60秒超时

        // 发送请求到火山方舟API
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify(requestData),
            signal: controller.signal
        });

        clearTimeout(timeout); // 清除超时计时器

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        // 处理流式响应
        let buffer = '';
        for await (const chunk of response.body) {
            const text = chunk.toString();
            buffer += text;
            
            // 处理可能的多个数据块
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留最后一个不完整的行
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.replace('data: ', '').trim();
                        if (jsonStr === '[DONE]') continue;
                        const jsonData = JSON.parse(jsonStr);
                        const content = jsonData.choices[0].delta.content;
                        if (content) {
                            res.write(content);
                        }
                    } catch (e) {
                        console.error('解析响应数据出错:', e, '\n原始数据:', line);
                    }
                }
            }
        }

        res.end();
    } catch (error) {
        console.error('处理请求出错:', error);
        let statusCode = 500;
        let errorMessage = '服务器内部错误';

        if (error.name === 'AbortError') {
            statusCode = 504;
            errorMessage = 'API请求超时';
        } else if (error.message === '无效的请求数据' || error.message === '消息长度超出限制') {
            statusCode = 400;
            errorMessage = error.message;
        } else if (error.message.includes('API请求失败')) {
            statusCode = 502;
            errorMessage = '上游服务暂时不可用';
        }

        res.status(statusCode).json({
            error: errorMessage,
            timestamp: new Date().toISOString(),
            requestId: Math.random().toString(36).substring(7)
        });
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
});