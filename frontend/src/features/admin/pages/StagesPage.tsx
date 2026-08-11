import { DeleteOutlined, EditOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Tag, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { stagesQueryKey } from '@/app/socket-context';
import {
  createStage,
  deleteStage,
  listStages,
  reorderStages,
  updateStage,
} from '@/features/stages/api/stage-api';
import type { StageDto } from '@/features/stages/api/stage-api';
import { translateError } from '@/shared/api/errors';
import { Can } from '@/shared/components/Can';
import { PageHeader } from '@/shared/components/PageHeader';

/**
 * Paleta pré-validada de cores com contraste AA (docs/08, "Administração /
 * Etapas"). O texto sobre cada cor é calculado por luminância; estas cores
 * garantem legibilidade com texto branco ou preto.
 */
const COLOR_PRESETS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
];

// --- Schema ---

const stageSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.'),
  color: z.string().min(4, 'Cor é obrigatória.'),
  isFinal: z.boolean(),
});

type StageFormValues = z.infer<typeof stageSchema>;

// --- Helpers ---

/** Calcula luminância relativa para decidir texto claro/escuro. */
function textColorForBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = [...list];
  const [removed] = result.splice(startIndex, 1);
  if (removed !== undefined) {
    result.splice(endIndex, 0, removed);
  }
  return result;
}

// --- Page ---

export function StagesPage(): ReactElement {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageDto | null>(null);

  const { data: stages = [], isLoading } = useQuery({
    queryKey: [...stagesQueryKey, 'admin'],
    queryFn: () => listStages(true),
  });

  const reorderMutation = useMutation({
    mutationFn: reorderStages,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const createMutation = useMutation({
    mutationFn: createStage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      void message.success('Etapa criada.');
      closeModal();
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      name?: string;
      color?: string;
      isFinal?: boolean;
    }) => updateStage(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      void message.success('Etapa atualizada.');
      closeModal();
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      void message.success('Etapa excluída.');
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StageFormValues>({
    resolver: zodResolver(stageSchema),
    defaultValues: { name: '', color: '#1677ff', isFinal: false },
  });

  function openCreate(): void {
    setEditingStage(null);
    reset({ name: '', color: '#1677ff', isFinal: false });
    setModalOpen(true);
  }

  function openEdit(stage: StageDto): void {
    setEditingStage(stage);
    reset({ name: stage.name, color: stage.color, isFinal: stage.isFinal });
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingStage(null);
  }

  function onSubmit(values: StageFormValues): void {
    if (editingStage) {
      updateMutation.mutate({ id: editingStage.id, ...values });
    } else {
      createMutation.mutate(values);
    }
  }

  function handleDragEnd(result: DropResult): void {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const reordered = reorder(stages, result.source.index, result.destination.index);
    // Atualização otimista local
    queryClient.setQueryData([...stagesQueryKey, 'admin'], reordered);
    // PATCH /stages/reorder (docs/05)
    reorderMutation.mutate(reordered.map((s) => s.id));
  }

  function handleDelete(stage: StageDto): void {
    if (stage.processCount && stage.processCount > 0) {
      void message.warning(
        `Esta etapa possui ${stage.processCount} processo(s) ativo(s) e não pode ser excluída.`,
      );
      return;
    }
    deleteMutation.mutate(stage.id);
  }

  function handleToggleFinal(stage: StageDto, checked: boolean): void {
    updateMutation.mutate({ id: stage.id, isFinal: checked });
  }

  return (
    <div>
      <PageHeader
        title="Etapas"
        extra={
          <Can perform="admin:manage">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Adicionar etapa
            </Button>
          </Can>
        }
      />

      {isLoading && <Typography.Text>Carregando...</Typography.Text>}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="stages-list">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {stages.map((stage, index) => (
                <Draggable key={stage.id} draggableId={stage.id} index={index}>
                  {(dragProvided) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      style={{
                        ...dragProvided.draggableProps.style,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        marginBottom: 8,
                        background: '#fff',
                        borderRadius: 6,
                        border: '1px solid #f0f0f0',
                      }}
                    >
                      <span
                        {...dragProvided.dragHandleProps}
                        aria-label="Arrastar para reordenar"
                        style={{ cursor: 'grab', color: '#999' }}
                      >
                        <HolderOutlined />
                      </span>

                      <Tag
                        color={stage.color}
                        style={{
                          color: textColorForBg(stage.color),
                          minWidth: 80,
                          textAlign: 'center',
                        }}
                      >
                        {stage.name}
                      </Tag>

                      <Space size="middle" style={{ marginLeft: 'auto' }}>
                        <Space size={4}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Final:
                          </Typography.Text>
                          <Can
                            perform="admin:manage"
                            fallback={<Switch checked={stage.isFinal} disabled size="small" />}
                          >
                            <Switch
                              checked={stage.isFinal}
                              onChange={(checked) => handleToggleFinal(stage, checked)}
                              size="small"
                              aria-label={`Etapa final: ${stage.name}`}
                            />
                          </Can>
                        </Space>

                        {stage.processCount !== undefined && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {stage.processCount} processo(s)
                          </Typography.Text>
                        )}

                        <Can perform="admin:manage">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEdit(stage)}
                            aria-label={`Editar etapa ${stage.name}`}
                          />
                        </Can>
                        <Can perform="admin:manage">
                          <Popconfirm
                            title="Excluir esta etapa?"
                            description={
                              stage.processCount && stage.processCount > 0
                                ? `Não é possível: ${stage.processCount} processo(s) nesta etapa.`
                                : 'A etapa será removida permanentemente.'
                            }
                            onConfirm={() => handleDelete(stage)}
                            okButtonProps={{
                              disabled: (stage.processCount ?? 0) > 0,
                            }}
                          >
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              aria-label={`Excluir etapa ${stage.name}`}
                            />
                          </Popconfirm>
                        </Can>
                      </Space>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <Modal
        open={modalOpen}
        title={editingStage ? 'Editar etapa' : 'Criar etapa'}
        onCancel={closeModal}
        onOk={() => void handleSubmit(onSubmit)()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={editingStage ? 'Salvar' : 'Criar'}
        cancelText="Cancelar"
      >
        <Form layout="vertical">
          <Form.Item
            label="Nome"
            required
            validateStatus={errors.name ? 'error' : ''}
            help={errors.name?.message}
          >
            <Controller
              name="name"
              control={control}
              render={({ field }) => <Input {...field} placeholder="Nome da etapa" />}
            />
          </Form.Item>
          <Form.Item
            label="Cor"
            required
            validateStatus={errors.color ? 'error' : ''}
            help={errors.color?.message}
          >
            <Controller
              name="color"
              control={control}
              render={({ field }) => (
                <Space wrap>
                  {COLOR_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type={field.value === preset ? 'primary' : 'default'}
                      size="small"
                      style={{
                        backgroundColor: preset,
                        borderColor: field.value === preset ? '#000' : preset,
                        width: 28,
                        height: 28,
                        minWidth: 28,
                        padding: 0,
                      }}
                      onClick={() => field.onChange(preset)}
                      aria-label={`Cor ${preset}`}
                    />
                  ))}
                  <Input
                    type="color"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    style={{ width: 40, height: 28, padding: 2, cursor: 'pointer' }}
                    aria-label="Selecionar cor personalizada"
                  />
                </Space>
              )}
            />
          </Form.Item>
          <Form.Item label="Etapa final">
            <Controller
              name="isFinal"
              control={control}
              render={({ field }) => (
                <Switch checked={field.value} onChange={field.onChange} aria-label="Etapa final" />
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
