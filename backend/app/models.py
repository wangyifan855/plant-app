"""Pydantic 响应模型，前后端 JSON 契约见需求文档 §6（D2 定稿后 freeze）。

单一 POST /analyze 按 task_type 返回不同分支：
- graft_screen      -> GraftResponse（兼容分 + 五档决策）
- plant_identify / graft_aftercare -> IdentifyResponse（物种 + 病害 + 建议）
- recovery_track    -> TrackResponse（当前结果 + 趋势 + 判定）
decision.code 五值：recommend / cautious / defer / not_recommend / retake，
单图识别场景用 info。
"""
from pydantic import BaseModel


# ---- 嫁接初筛（保持 v1 契约不变） ----

class DiseaseResult(BaseModel):
    label: str          # "healthy" | "diseased" | "unknown"
    confidence: float | None = None


class DiseaseBlock(BaseModel):
    scion: DiseaseResult
    rootstock: DiseaseResult


class CompatibilityBreakdown(BaseModel):
    family_genus: int
    temperature: int
    soil: int
    rootstock_affinity: int = 0   # 生产验证的抗病砧木组合加成（砧木在接穗 rootstocks 列表内）


class CompatibilityResult(BaseModel):
    score: int | None
    known: bool
    breakdown: CompatibilityBreakdown | None


class DecisionResult(BaseModel):
    code: str
    label: str
    explanation: str
    retake_required: bool
    low_confidence: bool = False   # 置信度处于低档：结果可用，但仅供参考


class VarietiesUsed(BaseModel):
    """本次分析实际采用的品种：name 中文名 / source = manual(手选) | auto(照片识别) | none(未定)。"""
    name: str | None = None
    source: str = "none"


class VarietiesUsedBlock(BaseModel):
    scion: VarietiesUsed
    rootstock: VarietiesUsed


class GraftResponse(BaseModel):
    disease: DiseaseBlock
    compatibility: CompatibilityResult
    decision: DecisionResult
    varieties: VarietiesUsedBlock | None = None
    diagnosis_id: int | None = None   # 已写入「最近诊断」的记录 id（未登录时为 None）


# ---- 单图识别（plant_identify / graft_aftercare） ----

class SpeciesResult(BaseModel):
    label: str
    confidence: float


class DiseaseInfo(BaseModel):
    label: str                  # "healthy" | "diseased" | "unknown"
    name: str | None = None     # 病害名，如 "Early Blight"
    confidence: float | None = None


class SimpleDecision(BaseModel):
    code: str                   # 单图识别固定 "info"
    label: str


class Candidate(BaseModel):
    """低置信度时的"相似疑似"候选项。"""
    label: str                  # 展示名，如 "番茄 · Septoria Leaf Spot"
    confidence: float


class LinkedPlant(BaseModel):
    """这次识别关联到的花园植物（从植物档案点「拍照记录」进来时才有）。"""
    plant_id: int
    plant_name: str
    track_id: str


class IdentifyResponse(BaseModel):
    species: SpeciesResult
    disease: DiseaseInfo
    suggestion: str
    decision: SimpleDecision
    candidates: list[Candidate] = []   # 仅低置信度分支返回
    linked_plant: LinkedPlant | None = None  # 关联到某株植物时返回，用来提示"已记录"
    graft_hint: "GraftHint | None" = None    # 命中土传/维管束病害时给出的砧木嫁接方案


# ---- 识别 → 嫁接联动：土传病害的砧木恢复方案 ----
class GraftStock(BaseModel):
    name: str          # 砧木品种名（与嫁接页下拉一致）
    note: str = ""     # 抗性与农艺说明


class GraftHint(BaseModel):
    crop: str          # 接穗作物中文名
    reason: str        # 为什么建议砧木嫁接（文案）
    rootstocks: list[GraftStock] = []


IdentifyResponse.model_rebuild()


# ---- 恢复追踪（recovery_track） ----

class TrackPoint(BaseModel):
    date: str
    disease_confidence: float | None


class CurrentBlock(BaseModel):
    date: str
    species: SpeciesResult
    disease: DiseaseInfo


class TrackResponse(BaseModel):
    track_id: str
    record_id: int
    current: CurrentBlock
    trend: list[TrackPoint]
    verdict: str
    explanation: str
