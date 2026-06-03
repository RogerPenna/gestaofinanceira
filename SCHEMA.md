# Mapeamento de Tabelas e Colunas (Grist)

## Boletos
- **Descricao**: Text
- **DataVencimento**: Date
- **Valor**: Numeric
- **Pago**: Bool
- **LembreteDias**: Int
- **LinkPdf**: Text
- **Status**: Formula (Text)
- *Nota: Faltam CategoriaId e ContaId nesta tabela segundo o mapeamento fornecido.*

## Cartoes
- **Nome**: Text
- **LimiteTotal**: Numeric
- **DiaFechamento**: Int
- **DiaVencimento**: Int
- **ContaId**: Reference (Contas)
- **LimiteDisponivel**: Formula (Numeric)

## GrupoCategorias
- **Nome**: Text

## Categorias
- **Nome**: Text
- **TipoPadrao**: Choice (Entrada/Saída)
- **GrupoRef**: Reference (GrupoCategorias)

## Contas
- **Nome**: Text
- **Tipo**: Choice
- **SaldoInicial**: Numeric
- **DataSaldoInicial**: Date
- **Cor**: Text
- **Ativa**: Bool
- **SaldoAtual**: Formula (Numeric)


## Parcelamentos
- **Descricao**: Text
- **ValorTotal**: Numeric
- **NumeroParcelas**: Int
- **DataCompra**: Date
- **CartaoId**: Reference (Cartoes)
- **ParcelasPagas**: Formula (Int)
- **ValorParcela**: Formula (Numeric)

## Programacoes
- **Descricao**: Text
- **Tipo**: Choice
- **DataInicio**: Date
- **DataFim**: Date
- **RegraValor**: Text
- **ContaId**: Reference (Contas)
- **ValorAtual**: Formula (Numeric)

## Recorrencias
- **Nome**: Text
- **Tipo**: Choice
- **CategoriaId**: Reference (Categorias)
- **Ativo**: Bool

## RecorrenciasRegras
- **RecorrenciaId**: Reference (Recorrencias)
- **MesInicio**: Int
- **Valor**: Numeric
- **DiaVencimento**: Int
- **AnoInicio**: Int
- **CartaoId**: Reference (Cartoes)
- **ContaId**: Reference (Contas)

## Transacoes
- **Data**: Date
- **Descricao**: Text
- **Tipo**: Choice
- **Status**: Choice
- **Valor**: Numeric
- **ContaId**: Reference (Contas)
- **CartaoId**: Reference (Cartoes)
- **CategoriaId**: Reference (Categorias)
- **ParcelamentoId**: Reference (Parcelamentos)
- **ProgramacaoId**: Reference (Programacoes)
- **BoletoId**: Reference (Boletos)
