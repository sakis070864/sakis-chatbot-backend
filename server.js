const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Firebase Admin SDK Initialization ---
try {
    // The FIREBASE_SERVICE_ACCOUNT_KEY environment variable should contain the entire JSON key file as a string.
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountString) {
        throw new Error('Firebase service account key environment variable is not set.');
    }
    const serviceAccount = JSON.parse(serviceAccountString);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');

} catch (error) {
    console.error('CRITICAL ERROR: Firebase Admin SDK initialization failed. Intake reports will not be saved.', error.message);
}

const db = admin.firestore();

// --- Nodemailer Configuration ---
const mailerConfig = {
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // Your Gmail address from environment variables
        pass: process.env.EMAIL_PASS      // Your Gmail App Password from environment variables
    }
};

// Runtime check for Nodemailer configuration
if (!mailerConfig.auth.user || !mailerConfig.auth.pass) {
    console.error('CRITICAL ERROR: Nodemailer is not configured. EMAIL_USER or EMAIL_PASS environment variables are missing. Email notifications will fail.');
}
const transporter = nodemailer.createTransport(mailerConfig);


// --- KNOWLEDGE BASE LOADING ---
let qaData = [];
try {
    const filePath = path.join(__dirname, '400QA2.json');
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        qaData = JSON.parse(fileContent);
        console.log(`Successfully loaded ${qaData.length} Q&A items into the knowledge base.`);
    } else {
        console.warn('WARNING: 400QA2.json not found. The general chatbot will have no custom knowledge.');
    }
} catch (error) {
    console.error('CRITICAL ERROR: Could not load or parse 400QA2.json.', error);
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES ---
app.get('/', (req, res) => {
    res.send('Sakis Athan AI Chatbot Server with RAG and Intake is running!');
});

/**
 * Endpoint for the general-purpose Q&A chatbot.
 */
app.post('/chat', async (req, res) => {
    console.log('--- NEW /chat REQUEST ---');
    
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Request body must contain a "message" field.' });
    }
    console.log(`[Chat-1] Received user message: "${message}"`);

    const getRelevantSnippets = (query, data, count = 7) => {
        const queryWords = query.toLowerCase().split(/\s+/);
        const scoredItems = data
            .filter(item => item.Q && item.A)
            .map(item => {
                const questionWords = item.Q.toLowerCase();
                let score = 0;
                queryWords.forEach(word => {
                    if (questionWords.includes(word)) {
                        score++;
                    }
                });
                return { ...item, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);

        return scoredItems.slice(0, count);
    };

    const relevantSnippets = getRelevantSnippets(message, qaData);
    const knowledgeBase = relevantSnippets.length > 0
        ? relevantSnippets.map(item => `Q: ${item.Q}\nA: ${item.A}`).join('\n\n')
        : 'No specific information found in the knowledge base for this query.';
    
    console.log(`[Chat-2] Found ${relevantSnippets.length} relevant snippets.`);

    const systemInstruction = {
        role: "system",
        content: `You are 'Sakis Bot', a friendly and professional AI assistant for Sakis Athan, an AI & Automation Engineer. 
        Your primary goal is to answer the user's question based on the provided "Relevant Information" below. You MUST prioritize this information. If the information provides a good answer, use it directly. If the information is not sufficient, you may use your general knowledge but you must relate it back to Sakis's skills and services.
        Keep your answers concise and helpful. Always be professional and encourage potential clients to get in touch for detailed project discussions. Sakis's contact info is sakissystems@gmail.com.
        --- RELEVANT INFORMATION START ---
        ${knowledgeBase}
        --- RELEVANT INFORMATION END ---
        `
    };

    const messages = [
        systemInstruction,
        { role: "user", content: message }
    ];

    try {
        console.log('[Chat-3] Sending request to OpenAI API...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo-0125',
                messages: messages,
            }),
        });
        
        console.log('[Chat-4] Received response from OpenAI.');

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[ERROR] OpenAI API returned status ${response.status}`, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const replyContent = data.choices[0]?.message?.content || "Sorry, I couldn't get a proper response. Please try again.";
        
        console.log('[Chat-5] Successfully processed reply. Sending response back to the client.');
        res.json({ reply: replyContent });

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the /chat try-catch block:', error.message);
        res.status(500).json({ error: 'Failed to fetch response from AI.' });
    }
});

/**
 * NEW Endpoint for the intelligent project intake conversation.
 */
app.post('/intake', async (req, res) => {
    console.log('--- NEW /intake REQUEST ---');

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is not configured on the server.' });
    }

    const { conversation } = req.body;

    if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
        return res.status(400).json({ error: 'Request body must contain a "conversation" array.' });
    }

    try {
        // Persona 1: The Project Analyst (for conversation)
        const analystSystemPrompt = `You are an expert AI Project Analyst working for Sakis Athan. Your goal is to conduct an intelligent interview with a potential client to fully understand their project needs.
        - Your current conversation history is provided below.
        - Your task is to ask the ONE best, most insightful follow-up question to clarify the user's needs.
        - Analyze the user's last message in the context of the whole conversation. Identify ambiguities, unstated assumptions, or missing details.
        - Ask open-ended questions. Avoid simple yes/no questions.
        - If the user's request seems clear, detailed, and actionable, and you have a good sense of the applications involved, the core workflow, and the desired outcome, you MUST end your response with the exact phrase: "[END_OF_INTAKE]".
        - Otherwise, just ask your clarifying question without any preamble.`;

        const analystMessages = [
            { role: 'system', content: analystSystemPrompt },
            ...conversation.map(msg => ({ role: msg.role, content: msg.content }))
        ];

        console.log('[Intake-1] Asking Analyst AI for the next question...');
        const analystResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({ model: 'gpt-3.5-turbo-0125', messages: analystMessages }),
        });

        if (!analystResponse.ok) throw new Error('Analyst AI API request failed.');

        const analystData = await analystResponse.json();
        let analystReply = analystData.choices[0]?.message?.content;

        if (analystReply.includes('[END_OF_INTAKE]')) {
            console.log('[Intake-2] Analyst determined intake is complete. Proceeding to report generation.');
            
            // Persona 2: The Project Manager (for report generation)
            // **MODIFICATION**: Added interviewDate to the required JSON keys and provided the current date.
            const currentDate = new Date().toUTCString();
            const managerSystemPrompt = `You are a Senior Project Manager. You will be given a transcript of a client interview. Your task is to create a structured, professional project report in JSON format.
            The JSON object must have these exact keys: "projectName", "projectSummary", "keyFeatures", "estimatedTimeline", "interviewDate".
            - projectName: A concise, descriptive name for the project.
            - projectSummary: A 2-3 sentence paragraph summarizing the client's problem and the proposed solution.
            - keyFeatures: An array of strings, with each string being a specific feature or requirement.
            - estimatedTimeline: A string providing a rough, non-binding estimate of the work required (e.g., "5-8 hours", "3-5 business days", "2-3 weeks").
            - interviewDate: The date and time of the interview. Use this exact value: "${currentDate}".
            Analyze the transcript carefully to provide a realistic estimate. Base your response ONLY on the provided transcript.`;

            const managerMessages = [
                { role: 'system', content: managerSystemPrompt },
                { role: 'user', content: `Here is the interview transcript:\n\n${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}` }
            ];
            
            console.log('[Intake-3] Asking Manager AI to generate the report...');
            const managerResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: 'gpt-3.5-turbo-0125', response_format: { type: "json_object" }, messages: managerMessages }),
            });

            if (!managerResponse.ok) throw new Error('Manager AI API request failed.');

            const managerData = await managerResponse.json();
            const reportJsonString = managerData.choices[0]?.message?.content;
            let report;

            // FIX: Added robust JSON parsing and validation to prevent server crash
            try {
                report = JSON.parse(reportJsonString);
                // **MODIFICATION**: Added validation for the new interviewDate field.
                if (!report.projectName || !report.projectSummary || !report.keyFeatures || !report.estimatedTimeline || !report.interviewDate) {
                    throw new Error("AI response was valid JSON but missing required fields.");
                }
            } catch (e) {
                console.error("Failed to parse or validate the report JSON from AI.", {
                    error: e.message,
                    aiResponse: reportJsonString
                });
                throw new Error("The AI failed to generate a valid project report. Please try again.");
            }

            // Generate Case Number
            const now = new Date();
            const caseNumber = `SA-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

            // Save to Firebase
            console.log(`[Intake-4] Saving report to Firestore with Case Number: ${caseNumber}`);
            await db.collection('intakeReports').doc(caseNumber).set({
                ...report,
                caseNumber: caseNumber,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                fullTranscript: conversation
            });

            // Send Email Notification
            console.log('[Intake-5] Sending email notification...');
            // **MODIFICATION**: Added the interview date to the email body.
            const emailBody = `
                <h1>New Project Intake Report</h1>
                <p><strong>Case Number:</strong> ${caseNumber}</p>
                <p><strong>Interview Date:</strong> ${report.interviewDate}</p>
                <hr>
                <h2>${report.projectName}</h2>
                <p><strong>Summary:</strong> ${report.projectSummary}</p>
                <h3>Key Features:</h3>
                <ul>
                    ${report.keyFeatures.map(f => `<li>${f}</li>`).join('')}
                </ul>
                <p><strong>Estimated Timeline:</strong> ${report.estimatedTimeline}</p>
                <hr>
                <h3>Full Transcript:</h3>
                ${conversation.map(m => `<p><strong>${m.role === 'user' ? 'Client' : 'Analyst'}:</strong> ${m.content}</p>`).join('')}
            `;

            await transporter.sendMail({
                from: `"Sakis AI Intake Bot" <${mailerConfig.auth.user}>`,
                to: "sakissystems@gmail.com",
                subject: `New Project Intake: ${report.projectName} (${caseNumber})`,
                html: emailBody,
            });

            console.log('[Intake-6] Process complete. Sending confirmation to client.');
            res.json({ status: 'complete', caseNumber: caseNumber, report: report });

        } else {
            // Conversation is still in progress
            console.log('[Intake-2] Analyst provided a new question. Continuing conversation.');
            res.json({ status: 'in-progress', reply: analystReply });
        }

    } catch (error) {
        console.error('[FATAL ERROR] An error occurred in the /intake try-catch block:', error.message);
        res.status(500).json({ error: 'An internal error occurred while processing your request.' });
    }
});


// --- SERVER START ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
