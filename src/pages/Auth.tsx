import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Shield, FileCheck, BarChart3 } from "lucide-react";

export default function Auth() {
  const [activeTab, setActiveTab] = useState("login");
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      navigate("/", { replace: true });
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return null;
  }

  const features = [
    {
      icon: DollarSign,
      title: "Pagamentos Pix",
      description: "Realize pagamentos com rastreabilidade total",
    },
    {
      icon: FileCheck,
      title: "Comprovantes Obrigatórios",
      description: "Nenhuma saída sem documentação contábil",
    },
    {
      icon: BarChart3,
      title: "Relatórios Inteligentes",
      description: "Custos vs Despesas prontos para o contador",
    },
    {
      icon: Shield,
      title: "Segurança",
      description: "Controle de acesso por perfil e auditoria completa",
    },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left side - Features */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-hero p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Pix Contábil</span>
          </div>

          <h1 className="text-4xl font-bold text-white mb-4">
            Gestão de Pagamentos
            <br />
            com Lastro Contábil
          </h1>
          <p className="text-white/80 text-lg mb-12">
            Controle total das saídas via Pix com rastreabilidade,
            classificação automática e relatórios prontos para contabilidade.
          </p>

          <div className="grid gap-6">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">{feature.title}</h3>
                  <p className="text-white/70 text-sm">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/50 text-sm">
          © 2024 Pix Contábil. Todos os direitos reservados.
        </p>
      </div>

      {/* Right side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-xl bg-gradient-primary flex items-center justify-center shadow-primary">
              <DollarSign className="h-7 w-7 text-white" />
            </div>
            <span className="text-2xl font-bold text-foreground">Pix Contábil</span>
          </div>

          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-2xl">
                {activeTab === "login" ? "Bem-vindo de volta" : "Criar conta"}
              </CardTitle>
              <CardDescription>
                {activeTab === "login"
                  ? "Entre com suas credenciais para acessar"
                  : "Preencha os dados para criar sua conta"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Entrar</TabsTrigger>
                  <TabsTrigger value="signup">Cadastrar</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-0">
                  <LoginForm />
                </TabsContent>

                <TabsContent value="signup" className="mt-0">
                  <SignUpForm onSuccess={() => setActiveTab("login")} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground mt-6 lg:hidden">
            © 2024 Pix Contábil. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
}
