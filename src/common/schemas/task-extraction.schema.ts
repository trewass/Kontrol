import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface ExtractedTask {
  is_task: boolean;
  title: string;
  description: string | null;
  assignee: string | null;
  priority: 'low' | 'normal' | 'high';
  due_text: string | null;
  due_at: string | null; // ISO8601
  client_name: string | null;
  object_name: string | null;
  tags: string[];
  confidence: number;
}

export const taskExtractionSchema = {
  type: 'object',
  properties: {
    is_task: { type: 'boolean' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    assignee: { type: ['string', 'null'] },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    due_text: { type: ['string', 'null'] },
    due_at: { type: ['string', 'null'], format: 'date-time' },
    client_name: { type: ['string', 'null'] },
    object_name: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'is_task',
    'title',
    'description',
    'assignee',
    'priority',
    'due_text',
    'due_at',
    'client_name',
    'object_name',
    'tags',
    'confidence',
  ],
  additionalProperties: false,
};

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
export const validateTaskExtraction = ajv.compile(taskExtractionSchema);
