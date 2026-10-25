import CompanyPack from "../models/CompanyPack.js";

export const listCompanyPacks = async (_req, res) => {
  try {
    const packs = await CompanyPack.find({ reviewed: true }).select("company role slug likelyTopics rounds").sort({ company: 1, role: 1 }).lean();
    return res.json({ packs });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "company_pack_list_failed", error: error.message }));
    return res.status(503).json({ message: "Company packs are temporarily unavailable" });
  }
};

export const getCompanyPack = async (req, res) => {
  try {
    const pack = await CompanyPack.findOne({ slug: req.params.slug, reviewed: true }).lean();
    return pack ? res.json({ pack }) : res.status(404).json({ message: "Company pack not found" });
  } catch (error) {
    return res.status(503).json({ message: "Company pack is temporarily unavailable" });
  }
};
