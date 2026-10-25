import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import llm from "../configs/llm.js";
import roadmapPrompt from "../configs/roadmap.prompt.js";
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js";

const roadmapAgent = async (state) => {
    const resume = state.useResume
        ? {
            skills: state.resume.skills,
            missingSkills: state.resume.missingSkills,
            projects: state.resume.projects,
            experience: state.resume.experience,
            score: state.resume.score,
            suggestedRole: state.resume.suggestedRole,
            recommendations: state.resume.recommendations,
        }
        : null;

    const response = await invokeWithRetry(llm, [
        new SystemMessage(roadmapPrompt),
        new HumanMessage(`Target Role: ${state.role}\nTarget Package: ${state.targetPackage}\nResume: ${JSON.stringify(resume)}`)
    ], 3, { feature: "roadmap-generation" });

    const roadmap = JSON.parse(cleanJson(response.content));

    const capitalize = (value = "") =>
        value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

    roadmap.level = capitalize(roadmap.level);
    roadmap.modules = (roadmap.modules || []).map((module) => ({
        ...module,
        difficulty: capitalize(module.difficulty),
    }));

    return { ...state, roadmap };
}

export default roadmapAgent
