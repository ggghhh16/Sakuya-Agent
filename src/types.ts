export type RunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type RunKind = 'research' | 'diagnosis';
export interface Project { id: string; name: string; description: string; repository: string; is_demo: boolean; created_at: string; updated_at: string }
export interface Source { title: string; url: string; content: string; type: string }
export interface Run { id: string; title: string; prompt: string; kind: RunKind; project_id: string; status: RunStatus; mode: 'demo' | 'live'; report: string; sources: Source[]; plan: string[]; tokens: number; experiment: boolean; script?: string; experiment_result?: string; approval?: { kind?: string; message: string; script?: string; name?: string; arguments?: unknown }; error?: string; ticket_id?: string; created_at: string; updated_at: string }
export interface RunEvent { seq: number; stage: string; message: string; created_at: string }
export interface Comment { id: string; content: string; author: string; internal: boolean; created_at: string }
export interface Ticket { id: string; title: string; description: string; project_id: string; status: 'open' | 'in_progress' | 'waiting' | 'resolved'; priority: 'low' | 'normal' | 'high'; customer: string; assignee: string; comments: Comment[]; is_demo: boolean; created_at: string; updated_at: string }
export interface Document { id: string; title: string; content: string; project_id: string; source: string; is_demo: boolean; created_at: string; updated_at: string }
export interface User { id: string; email: string; username: string; role: 'user' | 'admin' }
export interface ModelProvider { id: string; name: string; base_url: string; configured: boolean }
export interface ChatModel { id: string; provider_id: string; name: string; reasoning: boolean; context_window?: number | null }
export interface Settings { experimental_features?: boolean; providers: ModelProvider[]; models: ChatModel[]; default_model_id: string; model: string; base_url: string; model_configured: boolean; search_configured: boolean; github_configured: boolean; allowed_hosts: string[]; storage: string; version: string }
export interface Conversation { id: string; title: string; position: number; created_at: string; updated_at: string }
export interface ChatTurn extends Omit<Run, 'kind'> { kind: 'chat'; partial_report?: string; references?: import('./planner-references').PlannerReference[]; assistant?: 'chat' | 'planner'; conversation_id: string; tool_log?: {id: string; name: string; error: boolean}[] }
export interface Workspace { user: User; projects: Project[]; runs: Run[]; tickets: Ticket[]; documents: Document[]; settings: Settings; conversations: Conversation[]; chats: ChatTurn[] }
export type ModalState = { type: 'run'; kind: RunKind; ticket?: Ticket } | { type: 'project'; project?: Project } | { type: 'ticket' } | { type: 'document'; document?: Document } | { type: 'search' } | null;
export type Navigate = (path: string) => void;
