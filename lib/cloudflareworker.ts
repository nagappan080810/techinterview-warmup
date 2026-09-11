export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Please send a POST request matching the Session Schema.", { status: 405, headers: corsHeaders });
    }

    try {
      const sessionInput = await request.json();
      
      const { 
        technologies, 
        difficulty = "Medium", 
        jobTitle = "Senior Developer", 
        questionsPerTech = 4,
        extraSpecifications = ""
      } = sessionInput;

      if (!technologies || !Array.isArray(technologies) || technologies.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid Session Input. 'technologies' array is required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const agentOutputSchema = {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                technology: { type: "string" },
                area: { type: "string" },
                question: { type: "string" },
                isMultiSelect: { type: "boolean" },
                options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                correctIndexes: { type: "array", items: { type: "integer" } },
                explanation: { type: "string" },
                source: { type: "string", enum: ["model", "official-docs", "interview"] }
              },
              required: ["technology", "area", "question", "isMultiSelect", "options", "correctIndexes", "explanation", "source"]
            }
          }
        },
        required: ["questions"]
      };

      const aiPromises = technologies.map(async (tech) => {
        const systemPrompt = `You are mcq-generator, a question-generation engine for a technical MCQ quiz app. You produce high-quality interview MCQs in the style of a rapid technical grill.
        
        TASK:
        Generate exactly ${questionsPerTech} questions for the technology: "${tech}".
        Label all questions with "source": "model".
        
        CRITICAL QUESTION STYLE RULES:
        - Current Difficulty: ${difficulty}
        - Targeted Job Title: ${jobTitle}
        - If Easy or (Medium + Junior Developer): Straightforward factual questions. NO code snippets.
        - If (Medium + Mid-level Developer+) or Hard: Tricky questions. Include short code snippets (5-15 lines max using markdown fenced code blocks) testing edge cases and traps.
        
        CRITICAL EXPLANATION FIELD RULE:
        The explanation string MUST contain BOTH of these labeled parts explicitly:
        1. Begin with "Correct: " followed by why the correct answer(s) are right.
        2. Follow immediately with "Why the others are wrong: " followed by a distinct clause for EACH incorrect option labeled with its letter in square brackets, e.g., [A] ... [B] ... [C] ...
        
        CRITICAL correctIndexes RULE:
        "correctIndexes" MUST be an array of 0-based integer indices into the "options" array. The first option is index 0, the second is index 1, etc. For example, if the correct answer is the second option, write "correctIndexes": [1]. For multi-select, list all correct indexes, e.g. "correctIndexes": [0, 2]. Never include text or descriptions — ONLY integers.`;

        const userPrompt = `Generate the ${questionsPerTech} MCQs for "${tech}". 
        ${extraSpecifications ? `Incorporate these user instructions: ${extraSpecifications}` : ""} 
        Each question MUST have exactly 4 options (index 0..3) and "correctIndexes" MUST be an array of 0-based integers (e.g. [1] for single correct, [0,2] for multi-select). Never output text in correctIndexes.
        Output must match the requested JSON schema layout perfectly. No extra conversational markdown wraps outside the raw JSON object structure.`;

        const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.2,
          // 🔴 INCREASED: Expanded the text output allocation window to handle large explanations
          max_tokens: 2560, 
          response_format: { 
            type: "json_schema",
            json_schema: agentOutputSchema
          }
        });

        let dataObj;
        if (typeof res.response === "object" && res.response !== null) {
          dataObj = res.response;
        } else if (res.response && typeof res.response === "string") {
          dataObj = JSON.parse(res.response);
        } else if (res.result && typeof res.result === "object") {
          dataObj = res.result;
        } else {
          dataObj = res;
        }

        return dataObj.questions || [];
      });

      const resultsArray = await Promise.all(aiPromises);
      const finalAssessment = resultsArray.flat();

      return new Response(JSON.stringify(finalAssessment, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
