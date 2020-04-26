import * as path from "path";
import * as vscode from "vscode";
import mysqldump from 'mysqldump';
import { QueryUnit } from "../../database/QueryUnit";
import { ColumnNode } from "../other/columnNode";
import { InfoNode } from "../other/infoNode";
import { Node } from "../interface/node";
import { DatabaseCache } from "../../database/DatabaseCache";
import { ModelType, Constants } from "../../common/constants";
import { Console } from "../../common/outputChannel";
import { ConnectionManager } from "../../database/ConnectionManager";
import { MySQLTreeDataProvider } from "../../provider/mysqlTreeDataProvider";
import { Util } from "../../common/util";
import { CopyAble } from "../interface/copyAble";
import format = require('date-format');


export class TableNode extends Node implements CopyAble {

    public iconPath: string = path.join(Constants.RES_PATH, "table.svg");
    public contextValue: string = ModelType.TABLE;
    public primaryKey: string;

    constructor(readonly table: string, readonly info: Node) {
        super(table)
        this.id = `${info.host}_${info.port}_${info.user}_${info.database}_${table}`
        this.init(info)
        this.command = {
            command: "mysql.template.sql",
            title: "Run Select Statement",
            arguments: [this, true],
        }
    }

    public async getChildren(isRresh: boolean = false): Promise<Node[]> {
        let columnNodes = DatabaseCache.getColumnListOfTable(this.id);
        if (columnNodes && !isRresh) {
            return columnNodes;
        }
        return QueryUnit.queryPromise<any[]>(await ConnectionManager.getConnection(this), `SELECT COLUMN_NAME name,DATA_TYPE simpleType,COLUMN_TYPE type,COLUMN_COMMENT comment,COLUMN_KEY \`key\`,IS_NULLABLE nullable,CHARACTER_MAXIMUM_LENGTH maxLength FROM information_schema.columns WHERE table_schema = '${this.database}' AND table_name = '${this.table}';`)
            .then((columns) => {
                columnNodes = columns.map<ColumnNode>((column) => {
                    if (column && column.key == "PRI") {
                        this.primaryKey = column.name
                    }
                    return new ColumnNode(this.table, column, this.info);
                });
                DatabaseCache.setColumnListOfTable(this.id, columnNodes);

                return columnNodes;
            })
            .catch((err) => {
                return [new InfoNode(err)];
            });
    }

    public addColumnTemplate() {
        ConnectionManager.getConnection(this, true);
        QueryUnit.showSQLTextDocument(`ALTER TABLE
    ${Util.wrap(this.database)}.${Util.wrap(this.table)} 
ADD 
    COLUMN [column] [type] NOT NULL comment '';`);
    }


    public async showSource() {
        QueryUnit.queryPromise<any[]>(await ConnectionManager.getConnection(this, true), `SHOW CREATE TABLE \`${this.database}\`.\`${this.table}\``)
            .then((procedDtail) => {
                QueryUnit.showSQLTextDocument(procedDtail[0]['Create Table']);
            });
    }

    public changeTableName() {

        vscode.window.showInputBox({ value: this.table, placeHolder: 'newTableName', prompt: `You will changed ${this.database}.${this.table} to new table name!` }).then(async (newTableName) => {
            if (!newTableName) { return; }
            const sql = `RENAME TABLE \`${this.database}\`.\`${this.table}\` to \`${this.database}\`.\`${newTableName}\``;
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), sql).then((rows) => {
                DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`);
                MySQLTreeDataProvider.refresh();
            });

        });

    }

    public dropTable() {

        Util.confirm(`Are you want to drop table ${this.table} ? `, async () => {
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `DROP TABLE \`${this.database}\`.\`${this.table}\``).then(() => {
                DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`);
                MySQLTreeDataProvider.refresh();
                vscode.window.showInformationMessage(`Drop table ${this.table} success!`);
            });
        })

    }


    public truncateTable() {

        Util.confirm(`Are you want to clear table ${this.table} all data ?`, async () => {
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `truncate table \`${this.database}\`.\`${this.table}\``).then(() => {
                vscode.window.showInformationMessage(`Clear table ${this.table} all data success!`);
            });
        })

    }

    public indexTemplate() {
        ConnectionManager.getConnection(this, true);
        QueryUnit.showSQLTextDocument(`-- ALTER TABLE \`${this.database}\`.\`${this.table}\` DROP INDEX [indexName];
-- ALTER TABLE \`${this.database}\`.\`${this.table}\` ADD [UNIQUE|KEY|PRIMARY KEY] INDEX ([column]);`);
        setTimeout(() => {
            QueryUnit.runQuery(`SELECT COLUMN_NAME name,table_schema,index_name,non_unique FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema='${this.database}' and table_name='${this.table}';`, this);
        }, 10);

    }


    public async selectSqlTemplate(run: boolean) {
        const sql = `SELECT * FROM ${Util.wrap(this.database)}.${Util.wrap(this.table)} LIMIT ${Constants.DEFAULT_SIZE};`;

        if (run) {
            ConnectionManager.getConnection(this, true);
            QueryUnit.runQuery(sql, this);
        } else {
            QueryUnit.showSQLTextDocument(sql);
        }

    }

    public insertSqlTemplate(show: boolean = true): Promise<string> {
        return new Promise((resolve) => {
            this
                .getChildren()
                .then((children: Node[]) => {
                    const childrenNames = children.map((child: any) => "\n    " + child.column.name);
                    const childrenValues = children.map((child: any) => "\n    $" + child.column.name);
                    let sql = `insert into \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} `;
                    sql += `(${childrenNames.toString().replace(/,/g, ", ")}\n  )\n`;
                    sql += "values\n  ";
                    sql += `(${childrenValues.toString().replace(/,/g, ", ")}\n  );`;
                    if (show) {
                        QueryUnit.showSQLTextDocument(sql);
                    }
                    resolve(sql)
                });
        })
    }

    public deleteSqlTemplate(): any {
        this
            .getChildren()
            .then((children: Node[]) => {
                const keysNames = children.filter((child: any) => child.column.key).map((child: any) => child.column.name);

                const where = keysNames.map((name: string) => `${name} = ${name}`);

                let sql = `delete from \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} \n`;
                sql += `where \n  ${where.toString().replace(/,/g, "\n  and")}`;
                QueryUnit.showSQLTextDocument(sql);
            });
    }

    public updateSqlTemplate() {
        this
            .getChildren()
            .then((children: Node[]) => {
                const keysNames = children.filter((child: any) => child.column.key).map((child: any) => child.column.name);
                const childrenNames = children.filter((child: any) => !child.column.key).map((child: any) => child.column.name);

                const sets = childrenNames.map((name: string) => `${name} = ${name}`);
                const where = keysNames.map((name: string) => `${name} = '${name}'`);

                let sql = `update \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} \nset \n  ${sets.toString().replace(/,/g, ",\n  ")}\n`;
                sql += `where \n  ${where.toString().replace(/,/g, "\n  and ")}`;
                QueryUnit.showSQLTextDocument(sql);
            });
    }

    public async getMaxPrimary(): Promise<number> {

        const connection = await ConnectionManager.getConnection(this, false)

        if (this.primaryKey) {
            const count = await QueryUnit.queryPromise(connection, `select max(${this.primaryKey}) max from ${this.table}`);
            if (count && count[0]) { return count[0].max }
        }


        return Promise.resolve(0)
    }

    public backupData(exportPath: string) {

        Console.log(`Doing backup ${this.host}_${this.database}_${this.table}...`);
        mysqldump({
            connection: {
                host: this.host,
                user: this.user,
                password: this.password,
                database: this.database,
                port: parseInt(this.port),
            },
            dump: {
                tables: [this.table],
                schema: {
                    table: {
                        ifNotExist: false,
                        dropIfExist: true,
                        charset: false,
                    },
                    engine: false,
                },
            },
            dumpToFile: `${exportPath}\\${this.database}_${this.table}_${format('yyyy-MM-dd_hhmmss', new Date())}.sql`,
        }).then(() => {
            vscode.window.showInformationMessage(`Backup ${this.host}_${this.database}_${this.table} success!`);
        }).catch((err) => {
            vscode.window.showErrorMessage(`Backup ${this.host}_${this.database}_${this.table} fail!\n${err}`);
        });
        Console.log("backup end.");

    }

    public copyName(): void {
        Util.copyToBoard(this.table);
    }


}