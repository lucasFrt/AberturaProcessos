import { Button, Card, Flex, Result } from 'antd';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

/** Tela exibida quando a conta aguarda aprovação de um administrador. */
export function PendingPage(): ReactElement {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 420 }}>
        <Result
          status="info"
          title="Conta aguardando aprovação"
          subTitle="Sua conta foi criada e está aguardando a aprovação de um administrador. Você receberá acesso assim que ela for revisada."
          extra={
            <Link to="/login">
              <Button type="primary">Voltar para o login</Button>
            </Link>
          }
        />
      </Card>
    </Flex>
  );
}
