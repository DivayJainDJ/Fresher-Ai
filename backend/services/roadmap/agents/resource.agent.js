import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import llm from "../configs/llm.js";
import searchVideo from "../configs/youtube.js";
import { cleanJson, invokeWithRetry, sleep } from "../../../shared/utils/cleanJson.js";

const resourceAgent = async (state) => {
    try {
        const roadmap = state.roadmap;
        const modules = roadmap.modules || [];

        await sleep(3000);

        const BATCH = 3;
        const docsMap = new Map();

        for (let i = 0; i < modules.length; i += BATCH) {
            const batch = modules.slice(i, i + BATCH);
            const titles = batch.map(m => m.title).join("\n");

            try {
                const docsResponse = await invokeWithRetry(llm, [
                    new SystemMessage(`You are an expert software engineer.
For every module title below, return the best official documentation URL.
Return ONLY valid JSON array. No explanation. No markdown.
Format: [{"title":"","article":""}]`),
                    new HumanMessage(`Modules:\n${titles}`)
                ], 3, { feature: "roadmap-resource-links" });

                const docs = JSON.parse(cleanJson(docsResponse.content));
                docs.forEach(item => {
                    if (item.title && item.article) {
                        docsMap.set(item.title.toLowerCase(), item.article);
                    }
                });
            } catch (err) {
                console.log("Docs fetch failed for batch:", err.message);
            }

            if (i + BATCH < modules.length) {
                await sleep(5000);
            }
        }

        roadmap.modules = await Promise.all(
            modules.map(async (module) => {
                let video = null;
                try {
                    video = await searchVideo(module.title);
                } catch (err) {
                    console.log("YouTube search error:", err.message);
                }
                return {
                    ...module,
                    youtube: video?.url || "",
                    article: docsMap.get(module.title.toLowerCase()) || "",
                };
            })
        );

        return { ...state, roadmap };

    } catch (error) {
        console.log("Resource Agent Error:", error.message);
        return state;
    }
}

export default resourceAgent
