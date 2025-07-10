const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
// Render provides the PORT environment variable
const port = process.env.PORT || 3000;

// The API key will be set as an environment variable on the Render dashboard
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// IMPORTANT: Make sure cors() is used before the routes
app.use(cors());
// IMPORTANT: express.json() middleware MUST be used to parse the request body
app.use(express.json());


// A simple health check endpoint to make sure the server is running
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server is running!');
});

app.post('/chat', async (req, res) => {
    // =================================================================
    // DEBUGGING LOG: This will show us exactly what the server receives
    // =================================================================
    console.log('Received a request on /chat');
    console.log('Request Body:', req.body);
    // =================================================================

    if (!OPENAI_API_KEY) {
        console.error('Error: OpenAI API key is not configured.');
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }

    const { message } = req.body;

    if (!message) {
        // This is the source of the "400 Bad Request" error.
        // It means the req.body did not contain a "message" field.
        console.error('Error: Request body is missing the "message" field.');
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }

    const systemInstruction = {
        role: "system",
        content: "You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. Your purpose is to answer questions about his services and encourage potential clients to get in touch. Keep your answers concise and helpful. Services include: Business Process Automation, AI-Powered Solutions, and Custom System Integrations. Contact info: sakissystems@gmail.com. Always guide users to the contact form or direct contact for detailed project discussions."
    };

    const messages = [
        systemInstruction,
        { role: "user", content: message }
    ];

    try {
        console.log('Sending request to OpenAI...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: messages,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('OpenAI API Error:', response.status, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const replyContent = data.choices[0]?.message?.content || "Sorry, I couldn't get a proper response. Please try again.";
        
        console.log('Successfully got reply from OpenAI. Sending response to client.');
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('Catastrophic error in /chat route:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
