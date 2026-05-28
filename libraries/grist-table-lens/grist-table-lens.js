// libraries/grist-table-lens/grist-table-lens.js
// VERSÃO SEGURA: Adiciona novas funcionalidades sem alterar as existentes.

export const GristTableLens = function(gristInstance) {
    if (!gristInstance) {
        throw new Error("GristTableLens: Instância do Grist (grist object) é obrigatória.");
    }
    const _grist = gristInstance;
    const _metaState = {
        tables: null,
        columnsAndRules: null,
        tableSchemasCache: {},
        configCache: {},
        accessToken: null,
        baseUrl: null
    };

    /**
     * [NOVO] Obtém um token de acesso temporário do Grist para download de anexos.
     */
    this.getAccessToken = async function(forceRefresh = false) {
        if (_metaState.accessToken && !forceRefresh) return _metaState.accessToken;
        try {
            const response = await _grist.docApi.getAccessToken({ readOnly: true });
            _metaState.accessToken = response.token;
            _metaState.baseUrl = response.baseUrl;
            return _metaState.accessToken;
        } catch (e) {
            console.error("GTL: Erro ao obter accessToken do Grist", e);
            return null;
        }
    };

    /**
     * [NOVO] Retorna a URL base do documento Grist.
     */
    this.getBaseUrl = async function() {
        if (_metaState.baseUrl) return _metaState.baseUrl;
        await this.getAccessToken();
        return _metaState.baseUrl;
    };

    async function _loadGristMeta() {
        if (_metaState.tables && _metaState.columnsAndRules) return;
        const p = [];
        try {
            if (!_metaState.tables) {
                p.push(_grist.docApi.fetchTable('_grist_Tables').then(d => _metaState.tables = d));
            }
            if (!_metaState.columnsAndRules) {
                p.push(_grist.docApi.fetchTable('_grist_Tables_column').then(d => _metaState.columnsAndRules = d));
            }
            await Promise.all(p);
            if (!_metaState.tables || !_metaState.columnsAndRules) {
                throw new Error("_grist_Tables ou _grist_Tables_column não puderam ser carregados.");
            }
        } catch (error) {
            console.error("GTL: Falha _loadGristMeta.", error);
            _metaState.tables = null;
            _metaState.columnsAndRules = null;
            throw error;
        }
    }

    function _getNumericTableId(tableId) {
        if (!_metaState.tables?.tableId) return null;
        const idx = _metaState.tables.tableId.findIndex(t => String(t) === String(tableId));
        return idx === -1 ? null : String(_metaState.tables.id[idx]);
    }

    function _processColumnsAndRulesForTable(numericTableId, mode = 'clean', query = {}) {
        if (!_metaState.columnsAndRules?.id) { return {}; }
        const allEntries = _metaState.columnsAndRules;
        const numEntries = allEntries.id.length;
        const columnsOutput = {};
        const tableEntries = [];

        for (let i = 0; i < numEntries; i++) {
            if (String(allEntries.parentId[i]) === String(numericTableId)) {
                const entry = {};
                Object.keys(allEntries).forEach(key => { entry[key] = Array.isArray(allEntries[key]) ? allEntries[key][i] : allEntries[key]; });
                if (Object.keys(entry).length > 0 && entry.id !== undefined) tableEntries.push(entry);
            }
        }
        
        if (mode === 'raw') {
            const rawOutput = {};
            tableEntries.forEach(entry => {
                if(entry.colId) rawOutput[entry.colId] = entry;
            });
            return rawOutput;
        }
        
        if (mode === 'custom' && query.columns) {
            const customOutput = {};
            tableEntries.forEach(entry => {
                if (query.columns.includes(entry.colId)) {
                    const newCol = {};
                    const desiredKeys = query.metadata?.[entry.colId] || ['id', 'colId', 'label', 'type'];
                    desiredKeys.forEach(key => { if (entry[key] !== undefined) { newCol[key] = entry[key]; } });
                    customOutput[entry.colId] = newCol;
                }
            });
            return customOutput;
        }

        const rulesDefinitionsFromMeta = new Map();
        tableEntries.forEach(entry => {
            if (entry.colId?.startsWith("gristHelper_ConditionalRule") && entry.formula) {
                let ruleStyle = {};
                if (entry.widgetOptions) { 
                    try { 
                        const ruleOpts = JSON.parse(entry.widgetOptions);
                        ruleStyle = ruleOpts;
                    } catch (e) {} 
                }
                rulesDefinitionsFromMeta.set(String(entry.id), { id: String(entry.id), helperColumnId: String(entry.colId), conditionFormula: entry.formula, style: ruleStyle });
            }
        });

        tableEntries.forEach(entry => {
            const isDataColumn = entry.type && entry.colId;
            if (isDataColumn) {
                const wopts = JSON.parse(entry.widgetOptions || '{}');
                const conditionalFormattingRules = [];
                const ruleIdList = entry.rules;
                if (Array.isArray(ruleIdList) && ruleIdList[0] === 'L') {
                    const stylesFromWidgetOptions = wopts.rulesOptions || [];
                    ruleIdList.slice(1).forEach((rId, index) => {
                        const rd = rulesDefinitionsFromMeta.get(String(rId));
                        if (rd) {
                            rd.style = stylesFromWidgetOptions[index] || {};
                            conditionalFormattingRules.push(rd);
                         }
                    });
                }
                
                columnsOutput[entry.colId] = {
                    id: entry.id,
                    colId: entry.colId,
                    label: String(entry.label || entry.colId),
                    type: entry.type,
                    widgetOptions: wopts,
                    isFormula: entry.formula && String(entry.formula).trim() !== '',
                    formula: entry.formula,
                    rules: entry.rules,
                    displayCol: entry.displayCol,
                    conditionalFormattingRules: conditionalFormattingRules
                };
            }
        });
        return columnsOutput;
    }
    
    function _getDisplayColId(displayColIdNum, schemaToSearch) {
        if (!displayColIdNum) return null;
        const displayColSchema = Object.values(schemaToSearch).find(c => c.id === displayColIdNum);
        if (!displayColSchema) return null;
        if (displayColSchema.isFormula && displayColSchema.formula?.includes('.')) {
            const formulaParts = displayColSchema.formula.split('.');
            const finalColId = formulaParts[formulaParts.length - 1];
            const finalColExistsInTarget = Object.values(schemaToSearch).some(c => c.colId === finalColId);
            if(finalColExistsInTarget) return finalColId;
        }
        return displayColSchema.colId;
    }
    
    function _colDataToRows(colData) {
        if (!colData?.id) { return []; }
        const rows = [];
        const keys = Object.keys(colData);
        if (keys.length === 0 || !Array.isArray(colData[keys[0]])) { return []; }
        const numRows = colData.id.length;
        for (let i = 0; i < numRows; i++) {
            const r = { id: colData.id[i] };
            keys.forEach(k => { if (k !== 'id') r[k] = colData[k][i]; });
            rows.push(r);
        }
        return rows;
    }

    this.getTableSchema = async function(tableId, options = {}) {
        const { mode = 'clean', query = {} } = options;
        const cacheKey = query.name || mode;
        
        const resolvedId = await this.resolveTableId(tableId);
        
        if (_metaState.tableSchemasCache[resolvedId]?.[cacheKey]) { return _metaState.tableSchemasCache[resolvedId][cacheKey]; }
        await _loadGristMeta();
        const numId = _getNumericTableId(resolvedId);
        if (!numId) { return {}; }
        const schema = _processColumnsAndRulesForTable(numId, mode, query);
        if (!_metaState.tableSchemasCache[resolvedId]) { _metaState.tableSchemasCache[resolvedId] = {}; }
        _metaState.tableSchemasCache[resolvedId][cacheKey] = schema;
        return schema;
    };

    /**
     * [NOVO] Tenta encontrar o ID interno da tabela a partir de um nome ou do próprio ID.
     * @param {string} tableIdOrLabel O ID interno ou o Label da tabela.
     * @returns {Promise<string>} O ID interno resolvido.
     */
    this.resolveTableId = async function(tableIdOrLabel) {
        if (!tableIdOrLabel) return tableIdOrLabel;
        try {
            await _loadGristMeta();
            if (!_metaState.tables?.tableId) return tableIdOrLabel;

            // 1. Tenta por ID exato
            if (_metaState.tables.tableId.includes(tableIdOrLabel)) return tableIdOrLabel;

            // 2. Tenta por Label exato
            const labelIdx = _metaState.tables.label.findIndex(l => String(l) === String(tableIdOrLabel));
            if (labelIdx !== -1) return _metaState.tables.tableId[labelIdx];

            // 3. Tenta por Label (case-insensitive)
            const labelIdxCI = _metaState.tables.label.findIndex(l => String(l).toLowerCase() === String(tableIdOrLabel).toLowerCase());
            if (labelIdxCI !== -1) return _metaState.tables.tableId[labelIdxCI];

            // 4. Se não encontrou, retorna o original e deixa o Grist falhar se for o caso
            return tableIdOrLabel;
        } catch (e) {
            console.warn(`GTL: Erro ao tentar resolver tableId para "${tableIdOrLabel}". Usando original.`, e);
            return tableIdOrLabel;
        }
    };

    /**
     * [INALTERADO] Busca registros de uma tabela. Em caso de erro (ex: tabela não existe),
     * retorna um array vazio para manter compatibilidade com componentes antigos.
     */
    this.fetchTableRecords = async function(tableId) {
        if (!tableId) { return []; }
        try {
            const resolvedId = await this.resolveTableId(tableId);
            const rawData = await _grist.docApi.fetchTable(resolvedId);
            const records = _colDataToRows(rawData);
            records.forEach(r => { r.gristHelper_tableId = resolvedId; });
            return records;
        } catch (error) {
            console.error(`GTL.fetchTableRecords: Erro ao buscar registros para tabela '${tableId}'. Retornando array vazio.`, error);
            return [];
        }
    };
    
    /**
     * [NOVO] Busca registros de uma tabela. Em caso de erro (ex: tabela não existe),
     * LANÇA o erro para que o chamador possa tratá-lo adequadamente.
     */
    this.fetchTableRecordsOrThrow = async function(tableId) {
        if (!tableId) {
             throw new Error("GTL.fetchTableRecordsOrThrow: tableId não foi fornecido.");
        }
        try {
            const resolvedId = await this.resolveTableId(tableId);
            const rawData = await _grist.docApi.fetchTable(resolvedId);
            const records = _colDataToRows(rawData);
            records.forEach(r => { r.gristHelper_tableId = resolvedId; });
            return records;
        } catch (error) {
            console.error(`GTL.fetchTableRecordsOrThrow: Erro ao buscar registros para tabela '${tableId}'. Lançando o erro.`, error);
            throw error;
        }
    };

    /**
     * [NOVO] Encontra um único registro em uma tabela que corresponde a um filtro.
     * @param {string} tableId - O nome da tabela a ser pesquisada.
     * @param {object} filterObject - Um objeto chave/valor para filtrar. Ex: { id: 5 }
     * @returns {object|null} O primeiro registro encontrado ou null.
     */
    this.findRecord = async function(tableId, filterObject) {
        if (!tableId || !filterObject || Object.keys(filterObject).length === 0) {
            console.warn("GTL.findRecord: tableId ou filterObject inválido.", { tableId, filterObject });
            return null;
        }
        try {
            // Usa a versão segura que lança erro, para que o findRecord também seja "honesto".
            const records = await this.fetchTableRecordsOrThrow(tableId);
            const filterKeys = Object.keys(filterObject);
            const foundRecord = records.find(record => {
                return filterKeys.every(key => record[key] == filterObject[key]);
            });
            
            if (foundRecord) {
                foundRecord.gristHelper_tableId = tableId;
            }
            
            return foundRecord || null;
        } catch (error) {
            console.error(`GTL.findRecord: Erro ao tentar encontrar registro em '${tableId}' com filtro:`, filterObject, error);
            return null;
        }
    };

    this.listAllTables = async function() { await _loadGristMeta(); if (!_metaState.tables?.tableId) return []; return _metaState.tables.tableId.map((id, i) => ({ id: String(id), name: String(_metaState.tables.label?.[i] || id) })).filter(t => !t.id.startsWith('_grist_')); };

    this.fetchRecordById = async function(tableId, recordId) {
        if (!tableId || recordId === undefined) return null;
        try {
            // Atualizado para usar a nova função findRecord
            return await this.findRecord(tableId, { id: recordId });
        } catch (error) {
            console.error(`GTL.fetchRecordById: Erro ao buscar registro ${recordId} da tabela '${tableId}'.`, error);
            return null;
        }
    };
    
    this.fetchRelatedRecords = async function(primaryRecord, refColumnId) {
        if (!primaryRecord || !refColumnId) return [];
        const primaryTableId = primaryRecord.gristHelper_tableId;
        if (!primaryTableId) return [];
        const primarySchema = await this.getTableSchema(primaryTableId, { mode: 'clean' });
        const refColumnSchema = primarySchema[refColumnId];
        if (!refColumnSchema || !refColumnSchema.type.startsWith('RefList:')) return [];
        const referencedTableId = refColumnSchema.type.split(':')[1];
        if (!referencedTableId) return [];
        const refValue = primaryRecord[refColumnId];
        if (!Array.isArray(refValue) || refValue[0] !== 'L') return [];
        const relatedRecordIds = refValue.slice(1).filter(id => typeof id === 'number' && id > 0);
        if (relatedRecordIds.length === 0) return [];
        try {
            const allRelatedRecords = await this.fetchTableRecords(referencedTableId);
            const idSet = new Set(relatedRecordIds);
            const filteredRelatedRecords = allRelatedRecords.filter(r => idSet.has(r.id));
            return filteredRelatedRecords;
        } catch (error) {
            console.error(`GTL.fetchRelatedRecords: Erro ao buscar registros para '${refColumnId}'.`, error);
            return [];
        }
    };
    
    this.resolveReference = async function(colSchema, record) {
        if (!colSchema.type.startsWith('Ref:') || !record) {
            return { displayValue: `[Invalid Ref]`, referencedRecord: null };
        }
        const recordId = record[colSchema.colId];
        if (typeof recordId !== 'number' || recordId <= 0) {
            return { displayValue: '(vazio)', referencedRecord: null };
        }
        let finalDisplayColId = null;
        const displayColIdNum = colSchema.displayCol;
        if (displayColIdNum) {
            const sourceTableId = record.gristHelper_tableId;
            if (sourceTableId) {
                const sourceSchema = await this.getTableSchema(sourceTableId);
                const displayColHelperSchema = Object.values(sourceSchema).find(c => c.id === displayColIdNum);
                if (displayColHelperSchema) {
                    if (displayColHelperSchema.isFormula && displayColHelperSchema.formula?.includes('.')) {
                        const formulaParts = displayColHelperSchema.formula.split('.');
                        finalDisplayColId = formulaParts[formulaParts.length - 1];
                    } else {
                        finalDisplayColId = displayColHelperSchema.colId;
                    }
                }
            }
        }
        const referencedTableId = colSchema.type.split(':')[1];
        const referencedRecord = await this.fetchRecordById(referencedTableId, recordId);
        if (!referencedRecord) {
            return { displayValue: `[Ref Inválido: ${recordId}]`, referencedRecord: null };
        }
        const displayValue = finalDisplayColId ? referencedRecord[finalDisplayColId] : `[Ref: ${recordId}]`;
        return { displayValue, referencedRecord };
    };

    /**
     * [NOVO] Processa um registro da tabela Grf_config, unificando os campos
     * mappingJson, stylingJson e actionsJson em um único objeto de configuração.
     * Mantém compatibilidade com o campo legado configJson.
     */
    this.parseConfigRecord = function(record) {
        if (!record) return null;
        
        let mergedConfig = {};
        
        // 1. Carrega o legado se existir
        if (record.configJson) {
            try {
                mergedConfig = JSON.parse(record.configJson);
            } catch (e) {
                console.error("GTL.parseConfigRecord: Erro ao processar configJson legado.", e);
            }
        }
        
        // 2. Sobrepõe com os novos campos (Tripartição)
        // mappingJson -> Campos de mapeamento (tableId, layout, etc)
        if (record.mappingJson) {
            try {
                const mapping = JSON.parse(record.mappingJson);
                Object.assign(mergedConfig, mapping);
                // Mantém o objeto mapping original para compatibilidade com widgets que buscam config.mapping
                mergedConfig.mapping = mapping;
            } catch (e) { console.error("GTL.parseConfigRecord: Erro mappingJson.", e); }
        }
        
        // stylingJson -> Campos de estilo (styling)
        if (record.stylingJson) {
            try {
                const styling = JSON.parse(record.stylingJson);
                if (styling && typeof styling === 'object') {
                    const actualStyling = styling.styling || styling;
                    mergedConfig.styling = { ...(mergedConfig.styling || {}), ...actualStyling };
                }
            } catch (e) { console.error("GTL.parseConfigRecord: Erro stylingJson.", e); }
        }
        
        // actionsJson -> Campos de ação (sidePanel, iconGroups, etc)
        if (record.actionsJson) {
            try {
                const actions = JSON.parse(record.actionsJson);
                Object.assign(mergedConfig, actions);
                // Mantém o objeto actions original para compatibilidade
                mergedConfig.actions = actions;
            } catch (e) { console.error("GTL.parseConfigRecord: Erro actionsJson.", e); }
        }
        
        return mergedConfig;
    };

    this.fetchConfig = async function(configId) {
        if (!configId) {
            console.error("GTL.fetchConfig: configId não foi fornecido.");
            return null;
        }
        if (_metaState.configCache[configId]) {
            return _metaState.configCache[configId];
        }
        const configTableName = 'Grf_config';
        try {
            const configTableData = await _grist.docApi.fetchTable(configTableName);
            const configs = _colDataToRows(configTableData);
            const targetConfig = configs.find(c => c.configId === configId);
            if (!targetConfig) {
                throw new Error(`Configuração com id "${configId}" não encontrada na tabela "${configTableName}".`);
            }
            
            const parsedConfig = this.parseConfigRecord(targetConfig);
            parsedConfig.receivedConfigs = configs; // Anexa todas as configs para suporte a presets globais
            _metaState.configCache[configId] = parsedConfig;
            return parsedConfig;
        } catch (error) {
            console.error(`GTL.fetchConfig: Erro ao buscar ou processar a configuração "${configId}".`, error);
            throw error;
        }
    };
    
    /**
     * Retorna o ID da tabela referenciada por um campo Ref ou RefList.
     * @param {string} colId ID da coluna na tabela atual.
     * @returns {string|null} ID da tabela destino ou null.
     */
    this.getReferencedTableId = async function(colId, tableId = null) {
        const schema = await this.getTableSchema(tableId || _metaState.activeTableId);
        if (!schema || !schema[colId]) {
            // Se não encontrou no cache ou na tabela ativa, tenta buscar no schema da tabela fornecida explicitamente
            if (tableId) {
                const explicitSchema = await this.getTableSchema(tableId);
                if (explicitSchema && explicitSchema[colId]) {
                    const type = explicitSchema[colId].type;
                    if (type.startsWith('Ref:') || type.startsWith('RefList:')) {
                        return type.split(':')[1];
                    }
                }
            }
            return null;
        }
        
        const type = schema[colId].type;
        if (type.startsWith('Ref:') || type.startsWith('RefList:')) {
            return type.split(':')[1];
        }
        return null;
    };

    /**
     * [NOVO] Descobre qual campo na tabela de destino (targetTableId) aponta para a tabela de origem (sourceTableId).
     * Útil para preenchimento automático de vínculos (vínculo de contexto).
     * @param {string} targetTableId - Tabela onde queremos criar o registro (ex: "Perspectivas").
     * @param {string} sourceTableId - Tabela que é o contexto atual (ex: "Modelos").
     * @returns {string|null} O colId do campo de referência encontrado ou null.
     */
    this.findRelationField = async function(targetTableId, sourceTableId) {
        if (!targetTableId || !sourceTableId) return null;
        try {
            console.log(`GTL: Buscando relação entre ${targetTableId} (alvo) e ${sourceTableId} (origem)`);
            const schema = await this.getTableSchema(targetTableId);
            
            // Procura por Ref:SourceTableId ou RefList:SourceTableId
            const matchingFields = Object.values(schema).filter(col => 
                col.type && (col.type === `Ref:${sourceTableId}` || col.type === `RefList:${sourceTableId}` || col.type.startsWith(`Ref:${sourceTableId}:`) || col.type.startsWith(`RefList:${sourceTableId}:`))
            );

            if (matchingFields.length === 0) return null;
            if (matchingFields.length === 1) return matchingFields[0].colId;

            // Se houver mais de um, tenta encontrar um que pareça ser o "pai" ou principal
            const priorityField = matchingFields.find(f => 
                f.colId.toLowerCase().includes('ref_') || 
                f.colId.toLowerCase().includes('parent') ||
                f.colId.toLowerCase().includes(sourceTableId.toLowerCase())
            );

            return priorityField ? priorityField.colId : matchingFields[0].colId;
        } catch (e) {
            console.error(`GTL.findRelationField: Erro ao buscar relação entre ${targetTableId} e ${sourceTableId}`, e);
            return null;
        }
    };

    this.clearConfigCache = function(configId) {
        if (configId) {
            if (_metaState.configCache[configId]) {
                delete _metaState.configCache[configId];
                console.log(`GTL: Cache para '${configId}' foi limpo.`);
            }
        } else {
            _metaState.configCache = {};
            console.log("GTL: Todo o cache de configurações foi limpo.");
        }
    };

    /**
     * Formata um valor de célula com base no schema da coluna e opções do Grist.
     * @param {*} value O valor bruto da célula.
     * @param {object} colSchema O schema da coluna (ex: do getTableSchema).
     * @returns {string} O valor formatado para exibição.
     */
    this.formatValue = function(value, colSchema) {
        if (value === null || value === undefined || value === '') return '';
        
        // Se não tem schema, tenta formatar como número se for possível, senão retorna string
        if (!colSchema) {
            const num = Number(value);
            return isNaN(num) ? String(value) : num.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }

        const type = colSchema.type || '';
        const wopts = colSchema.widgetOptions || {};
        const numValue = Number(value);
        const isActuallyNumeric = !isNaN(numValue) && typeof value !== 'boolean';

        // --- FORMATAÇÃO NUMÉRICA (Numeric, Int, ou qualquer valor numérico se o schema for genérico) ---
        if (type === 'Numeric' || type === 'Int' || (isActuallyNumeric && (type === 'Any' || type === ''))) {
            let decimals = (type === 'Int') ? 0 : 2;
            if (wopts.numDecimalPlaces !== undefined) {
                decimals = parseInt(wopts.numDecimalPlaces, 10);
            } else if (type === 'Any' || type === '') {
                decimals = 1; // Default para tipos genéricos que contêm números
            }

            const numFormat = wopts.numFormat || 'comma'; // 'comma' ou 'none'
            const symbol = wopts.symbol || ''; // Ex: R$, $, %
            
            // Usamos Intl.NumberFormat para respeitar o padrão brasileiro (pontos nos milhares, vírgula no decimal)
            const formatterOptions = {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
                useGrouping: numFormat === 'comma'
            };

            const formatter = new Intl.NumberFormat('pt-BR', formatterOptions);
            let formatted = formatter.format(numValue);

            if (symbol) {
                if (symbol === '%') return `${formatted}${symbol}`;
                return `${symbol} ${formatted}`;
            }
            return formatted;
        }

        // Fallback para outros tipos (Data, Texto, etc.)
        return String(value);
    };

    /**
     * [NOVO] Encaminha ações de escrita para o Grist.
     */
    this.updateRecord = async function(tableId, recordId, changes) {
        const cleanId = typeof recordId === 'string' && /^\d+$/.test(recordId) ? parseInt(recordId, 10) : recordId;
        return _grist.docApi.applyUserActions([['UpdateRecord', tableId, cleanId, changes]]);
    };

    this.addRecord = async function(tableId, newRecord) {
        return _grist.docApi.applyUserActions([['AddRecord', tableId, null, newRecord]]);
    };

    this.deleteRecords = async function(tableId, recordIds) {
        const cleanIds = Array.isArray(recordIds)
            ? recordIds.map(id => typeof id === 'string' && /^\d+$/.test(id) ? parseInt(id, 10) : id)
            : recordIds;
        return _grist.docApi.applyUserActions([['BulkRemoveRecord', tableId, cleanIds]]);
    };
};
