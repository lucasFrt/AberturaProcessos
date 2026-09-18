import { DeleteOutlined, DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { App, Button, Flex, List, Tag, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import type { RcFile } from 'antd/es/upload';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { useAuthStore } from '@/features/auth/store/auth-store';
import type { ProcessDetailDto } from '@/features/processes/api/process-api';
import { downloadDocument } from '@/features/processes/api/process-api';
import { useDeleteDocument } from '@/features/processes/hooks/useDeleteDocument';
import { useUploadDocuments } from '@/features/processes/hooks/useUploadDocuments';
import { translateError } from '@/shared/api/errors';
import { formatDateTime, formatFileSize } from '@/shared/lib/format';

interface DocumentsTabProps {
  process: ProcessDetailDto;
}

/**
 * Aba "Documentos" da gaveta (docs/08, "Gaveta de detalhe"): uploader,
 * lista com nome/tamanho/tipo/autor/data, download via blob e exclusão
 * conforme permissão. Regra de exclusão espelha `document-service.ts`
 * (backend): OPERATIONAL/ADMIN excluem qualquer documento; CLIENT só o
 * que ele mesmo enviou.
 */
export function DocumentsTab({ process }: DocumentsTabProps): ReactElement {
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const { mutate: upload, isPending: isUploading } = useUploadDocuments();
  const { mutate: removeDocument, isPending: isDeleting } = useDeleteDocument();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  function canDelete(uploadedById: string): boolean {
    if (!user) return false;
    if (user.role === 'CLIENT') return uploadedById === user.id;
    return true;
  }

  async function handleDownload(documentId: string, originalName: string): Promise<void> {
    setDownloadingId(documentId);
    try {
      await downloadDocument(documentId, originalName);
    } catch (error) {
      void message.error(translateError(error));
    } finally {
      setDownloadingId(null);
    }
  }

  function handleDelete(documentId: string): void {
    removeDocument(
      { processId: process.id, documentId },
      { onSuccess: () => void message.success('Documento excluído.') },
    );
  }

  const uploadProps: UploadProps = {
    multiple: true,
    showUploadList: false,
    beforeUpload: () => false,
    onChange: ({ fileList }) => {
      const files = fileList
        .map((item) => item.originFileObj)
        .filter((file): file is RcFile => file !== undefined);
      if (files.length === 0) return;
      upload(
        { processId: process.id, files },
        {
          onSuccess: () => void message.success('Documento(s) enviado(s).'),
          onError: (error) => void message.error(translateError(error)),
        },
      );
    },
  };

  return (
    <Flex vertical gap={16}>
      {process.permissions.canUploadDocument && (
        <Upload.Dragger {...uploadProps} disabled={isUploading}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Clique ou arraste arquivos para esta área</p>
          <p className="ant-upload-hint">O envio ocorre imediatamente, arquivo por arquivo.</p>
        </Upload.Dragger>
      )}

      <List
        dataSource={process.documents}
        locale={{ emptyText: 'Nenhum documento anexado.' }}
        renderItem={(doc) => (
          <List.Item
            actions={[
              <Button
                key="download"
                type="link"
                icon={<DownloadOutlined />}
                loading={downloadingId === doc.id}
                onClick={() => void handleDownload(doc.id, doc.originalName)}
                aria-label={`Baixar ${doc.originalName}`}
              >
                Baixar
              </Button>,
              canDelete(doc.uploadedBy.id) && (
                <Button
                  key="delete"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  loading={isDeleting}
                  onClick={() => handleDelete(doc.id)}
                  aria-label={`Excluir ${doc.originalName}`}
                >
                  Excluir
                </Button>
              ),
            ]}
          >
            <List.Item.Meta
              title={doc.originalName}
              description={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatFileSize(doc.size)} · {doc.mimeType} · {doc.uploadedBy.name} ·{' '}
                  {formatDateTime(doc.createdAt)}
                  {doc.source === 'EMAIL' && (
                    <>
                      {' '}
                      · <Tag color="geekblue">e-mail</Tag>
                      {doc.receivedAt && `recebido em ${formatDateTime(doc.receivedAt)}`}
                    </>
                  )}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />
    </Flex>
  );
}
